import { z } from 'zod';
import { Redis, Cluster } from 'ioredis';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_URL: z.url(),
  SERVICE_API_KEY: z.string().min(32),
  REDIS_URL: z.string().regex(/^rediss?:\/\//),
  REDIS_CLUSTER_MODE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_CT_STUDIES_BUCKET: z.string().optional(),
  S3_CT_STUDIES_PREFIX: z.string().optional(),
  S3_MRI_STUDIES_BUCKET: z.string().optional(),
  S3_MRI_STUDIES_PREFIX: z.string().optional(),
  S3_XRAY_STUDIES_BUCKET: z.string().optional(),
  S3_XRAY_STUDIES_PREFIX: z.string().optional(),
  S3_MAMMOGRAPHY_STUDIES_BUCKET: z.string().optional(),
  S3_MAMMOGRAPHY_STUDIES_PREFIX: z.string().optional(),
  S3_SOURCE_PREFIX: z.string().min(1).refine(v => v.endsWith('/'), 'Must end in /'),
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
  if (config.SERVICE_API_KEY.startsWith('replace-')) throw new Error('Generate a new SERVICE_API_KEY before starting');
  if (config.S3_SOURCE_PREFIX.startsWith(config.S3_DERIVED_PREFIX) || config.S3_DERIVED_PREFIX.startsWith(config.S3_SOURCE_PREFIX)) throw new Error('S3 source and derived prefixes must not overlap');
  return config;
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

export type Modality = 'CT' | 'MRI' | 'XRAY' | 'MAMMOGRAPHY';
export function sourceLocation(config: Config, modality?: Modality): { bucket: string; prefix: string } {
  const bucket = modality ? config[`S3_${modality}_STUDIES_BUCKET`] : config.S3_BUCKET;
  const prefix = modality ? config[`S3_${modality}_STUDIES_PREFIX`] : config.S3_SOURCE_PREFIX;
  if (!bucket || !prefix) throw new Error('Modality storage has not been configured');
  return { bucket, prefix: `${prefix.replace(/\/+$/, '')}/` };
}
