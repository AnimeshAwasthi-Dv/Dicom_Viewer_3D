import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_URL: z.url(),
  SERVICE_API_KEY: z.string().min(32),
  VIEWER_DATA_DIR: z.string().min(1).default('data'),
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
  S3_ADDITIONAL_SOURCE_PREFIXES: z.string().optional(),
  S3_DERIVED_PREFIX: z.string().default('viewer-derived/').refine(v => v.endsWith('/'), 'Must end in /'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  MAX_ZIP_BYTES: z.coerce.number().int().positive().default(8 * 1024 ** 3),
  MAX_ENTRY_BYTES: z.coerce.number().int().positive().default(128 * 1024 ** 2),
  MAX_EXPANDED_BYTES: z.coerce.number().int().positive().default(32 * 1024 ** 3),
  MAX_ZIP_ENTRIES: z.coerce.number().int().positive().default(20000)
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  const config = schema.parse(process.env);
  const url = new URL(config.PUBLIC_URL);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('PUBLIC_URL must use HTTPS outside localhost');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_URL must be an origin without credentials, path, query or fragment');
  if (config.SERVICE_API_KEY.startsWith('replace-')) throw new Error('Generate a new SERVICE_API_KEY before starting');
  for (const modality of [undefined, 'CT', 'MRI', 'XRAY', 'MAMMOGRAPHY'] as const) {
    const location = sourceLocation(config, modality);
    for (const prefix of location.prefixes) {
      if (!prefix.endsWith('/') || prefix.startsWith('/') || prefix.includes('..') || prefix.includes('\\')) throw new Error('S3 source prefixes must be relative paths ending in /');
      if (location.bucket === config.S3_BUCKET && (prefix.startsWith(config.S3_DERIVED_PREFIX) || config.S3_DERIVED_PREFIX.startsWith(prefix))) throw new Error('S3 source and derived prefixes must not overlap');
    }
  }
  return config;
}

export type Modality = 'CT' | 'MRI' | 'XRAY' | 'MAMMOGRAPHY';
export function sourceLocation(config: Config, modality?: Modality): { bucket: string; prefix: string; prefixes: string[] } {
  const overrideBucket = modality ? config[`S3_${modality}_STUDIES_BUCKET`] : undefined;
  const overridePrefix = modality ? config[`S3_${modality}_STUDIES_PREFIX`] : undefined;
  if (Boolean(overrideBucket) !== Boolean(overridePrefix)) throw new Error('Configure both modality bucket and prefix');
  const bucket = overrideBucket || config.S3_BUCKET;
  const prefix = `${(overridePrefix || config.S3_SOURCE_PREFIX).replace(/\/+$/, '')}/`;
  const additional = overridePrefix ? [] : (config.S3_ADDITIONAL_SOURCE_PREFIXES ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return { bucket, prefix, prefixes: [prefix, ...additional] };
}

export function allowedSourceKey(key: string, prefixes: string[]): boolean {
  return !key.includes('\\') && !key.split('/').some(part => part === '.' || part === '..') &&
    prefixes.some(prefix => key.startsWith(prefix) && key.length > prefix.length);
}
