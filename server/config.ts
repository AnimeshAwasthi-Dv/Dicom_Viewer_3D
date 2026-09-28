import { z } from 'zod';
import { Redis, Cluster } from 'ioredis';
import { MODALITIES, readTenantsFile, type Tenant } from './tenants';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_URL: z.url(),
  // Several products (DecXpert, RadAgent…) on one viewer: a JSON file of tenants, each with its own API key and
  // storage (AWS S3 or an S3-compatible store such as Cloudflare R2). See docs/ec2-viewer-service.md.
  TENANTS_FILE: z.string().min(1).optional(),
  // Single-product setup, used when TENANTS_FILE is not set: one tenant, "default", from the variables below.
  SERVICE_API_KEY: z.string().min(32).optional(),
  REDIS_URL: z.string().regex(/^rediss?:\/\//),
  REDIS_CLUSTER_MODE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  AWS_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(3).optional(),
  S3_CT_STUDIES_BUCKET: z.string().optional(),
  S3_CT_STUDIES_PREFIX: z.string().optional(),
  S3_MRI_STUDIES_BUCKET: z.string().optional(),
  S3_MRI_STUDIES_PREFIX: z.string().optional(),
  S3_XRAY_STUDIES_BUCKET: z.string().optional(),
  S3_XRAY_STUDIES_PREFIX: z.string().optional(),
  S3_MAMMOGRAPHY_STUDIES_BUCKET: z.string().optional(),
  S3_MAMMOGRAPHY_STUDIES_PREFIX: z.string().optional(),
  S3_SOURCE_PREFIX: z.string().min(1).refine(v => v.endsWith('/'), 'Must end in /').optional(),
  S3_DERIVED_PREFIX: z.string().default('viewer-derived/').refine(v => v.endsWith('/'), 'Must end in /'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  MAX_ZIP_BYTES: z.coerce.number().int().positive().default(8 * 1024 ** 3),
  MAX_ENTRY_BYTES: z.coerce.number().int().positive().default(128 * 1024 ** 2),
  MAX_EXPANDED_BYTES: z.coerce.number().int().positive().default(32 * 1024 ** 3),
  MAX_ZIP_ENTRIES: z.coerce.number().int().positive().default(20000),
  // Origins allowed to embed the viewer in a frame, space-separated (for example the portal's origin). Unset keeps
  // embedding unrestricted, as before this setting existed.
  FRAME_ANCESTORS: z.string().transform(v => v.trim() || undefined)
    .refine(v => !v || v.split(/\s+/).every(origin => origin === "'self'" || /^https?:\/\/[^/\s]+$/.test(origin)), 'Use origins (https://portal.example.com) or \'self\', separated by spaces')
    .optional()
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  const config = schema.parse(process.env);
  const url = new URL(config.PUBLIC_URL);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('PUBLIC_URL must use HTTPS outside localhost');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_URL must be an origin without credentials, path, query or fragment');
  return config;
}

/** The configured tenants: from TENANTS_FILE, or the single "default" tenant the S3_* variables describe. */
export function readTenants(config: Config): Tenant[] {
  if (config.TENANTS_FILE) return readTenantsFile(config.TENANTS_FILE);
  const { SERVICE_API_KEY, S3_BUCKET, S3_SOURCE_PREFIX, AWS_REGION } = config;
  if (!SERVICE_API_KEY || !S3_BUCKET || !S3_SOURCE_PREFIX || !AWS_REGION) throw new Error('Set TENANTS_FILE, or SERVICE_API_KEY, AWS_REGION, S3_BUCKET and S3_SOURCE_PREFIX');
  if (SERVICE_API_KEY.startsWith('replace-')) throw new Error('Generate a new SERVICE_API_KEY before starting');
  if (S3_SOURCE_PREFIX.startsWith(config.S3_DERIVED_PREFIX) || config.S3_DERIVED_PREFIX.startsWith(S3_SOURCE_PREFIX)) throw new Error('S3 source and derived prefixes must not overlap');
  const sources: Tenant['sources'] = { default: { bucket: S3_BUCKET, prefix: S3_SOURCE_PREFIX } };
  for (const modality of MODALITIES) {
    const bucket = config[`S3_${modality}_STUDIES_BUCKET`];
    const prefix = config[`S3_${modality}_STUDIES_PREFIX`];
    if (bucket && prefix) sources[modality] = { bucket, prefix: `${prefix.replace(/\/+$/, '')}/` };
  }
  return [{
    id: 'default',
    apiKey: SERVICE_API_KEY,
    storage: { region: AWS_REGION, forcePathStyle: false },
    sources,
    derived: { bucket: S3_BUCKET, prefix: config.S3_DERIVED_PREFIX },
    frameAncestors: []
  }];
}

export function redisConnection(config: Config, blocking = false): Redis | Cluster {
  const parsed = new URL(config.REDIS_URL);
  const options = {
    host: parsed.hostname, port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' ? { tls: { servername: parsed.hostname } } : {}),
    maxRetriesPerRequest: blocking ? null : 1,
    lazyConnect: true,
    connectTimeout: 10000
  };
  const client = config.REDIS_CLUSTER_MODE
    ? new Cluster([{ host: options.host, port: options.port }], {
      lazyConnect: true, redisOptions: options,
      dnsLookup: (address, callback) => callback(null, address)
    })
    : new Redis(options);
  client.on('error', () => console.error('Redis connection error'));
  return client;
}
