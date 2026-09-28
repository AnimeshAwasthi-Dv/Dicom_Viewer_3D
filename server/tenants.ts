import fs from 'node:fs';
import { z } from 'zod';
import { matchesSecret } from './sessions';

/**
 * A product that uses the viewer (DecXpert, RadAgent…): its own API key, its own object storage (AWS S3, or any
 * S3-compatible store such as Cloudflare R2) and the sites allowed to embed its viewer links. Studies and sessions
 * belong to one tenant; another tenant's key can neither see nor use them, and derived images are written to the
 * tenant's own bucket.
 */
export const MODALITIES = ['CT', 'MRI', 'XRAY', 'MAMMOGRAPHY'] as const;
export type Modality = (typeof MODALITIES)[number];

export interface StorageLocation { bucket: string; prefix: string }
export interface Tenant {
  id: string;
  apiKey: string;
  storage: {
    /** S3-compatible endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com. Omitted for AWS S3. */
    endpoint?: string;
    region: string;
    /** Omitted to use the default AWS credential chain (instance role, environment). */
    credentials?: { accessKeyId: string; secretAccessKey: string };
    forcePathStyle: boolean;
  };
  /** Where source ZIPs may be read from: per modality, and `default` for requests that name none. */
  sources: Partial<Record<Modality | 'default', StorageLocation>>;
  /** Where extracted instances and the study index are written. */
  derived: StorageLocation;
  frameAncestors: string[];
}

/** `env:NAME` reads the value from the environment, so secrets can stay out of the tenants file. */
function resolveSecret(value: string, env: NodeJS.ProcessEnv): string {
  if (!value.startsWith('env:')) return value;
  const resolved = env[value.slice(4)];
  if (!resolved) throw new Error(`Environment variable ${value.slice(4)} is not set`);
  return resolved;
}

const prefix = z.string().min(1).refine(value => value.endsWith('/'), 'Must end in /');
const location = z.object({ bucket: z.string().min(3), prefix }).strict();
const origin = z.string().refine(value => value === "'self'" || /^https?:\/\/[^/\s]+$/.test(value), 'Use an origin such as https://portal.example.com');
const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Lowercase letters, digits and hyphens'),
  apiKey: z.string().min(1),
  storage: z.object({
    endpoint: z.url().optional(),
    region: z.string().min(1).optional(),
    accessKeyId: z.string().min(1).optional(),
    secretAccessKey: z.string().min(1).optional(),
    forcePathStyle: z.boolean().optional()
  }).strict().default({}),
  sources: z.partialRecord(z.enum([...MODALITIES, 'default']), location),
  derived: location,
  frameAncestors: z.array(origin).default([])
}).strict();
const fileSchema = z.object({ tenants: z.array(tenantSchema).min(1) }).strict();

function validate(tenant: Tenant): Tenant {
  if (tenant.apiKey.length < 32 || tenant.apiKey.startsWith('replace-')) throw new Error(`Tenant ${tenant.id}: generate an API key of at least 32 characters`);
  if (!Object.keys(tenant.sources).length) throw new Error(`Tenant ${tenant.id}: configure at least one source location`);
  for (const source of Object.values(tenant.sources)) {
    if (source!.bucket === tenant.derived.bucket && (source!.prefix.startsWith(tenant.derived.prefix) || tenant.derived.prefix.startsWith(source!.prefix))) {
      throw new Error(`Tenant ${tenant.id}: source and derived prefixes must not overlap`);
    }
  }
  return tenant;
}

/** Tenants from a JSON file (`{ "tenants": [...] }`). */
export function parseTenants(json: unknown, env: NodeJS.ProcessEnv = process.env): Tenant[] {
  const tenants = fileSchema.parse(json).tenants.map((raw): Tenant => {
    const accessKeyId = raw.storage.accessKeyId && resolveSecret(raw.storage.accessKeyId, env);
    const secretAccessKey = raw.storage.secretAccessKey && resolveSecret(raw.storage.secretAccessKey, env);
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error(`Tenant ${raw.id}: give both accessKeyId and secretAccessKey, or neither`);
    if (raw.storage.endpoint && !accessKeyId) throw new Error(`Tenant ${raw.id}: an S3-compatible endpoint needs its own access keys`);
    return validate({
      id: raw.id,
      apiKey: resolveSecret(raw.apiKey, env),
      storage: {
        endpoint: raw.storage.endpoint,
        // R2 and most S3-compatible stores take any region; "auto" is R2's.
        region: raw.storage.region ?? (raw.storage.endpoint ? 'auto' : 'us-east-1'),
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
        // Path-style works with R2 and self-hosted stores without wildcard DNS for bucket names.
        forcePathStyle: raw.storage.forcePathStyle ?? Boolean(raw.storage.endpoint)
      },
      sources: raw.sources,
      derived: raw.derived,
      frameAncestors: raw.frameAncestors
    });
  });
  const ids = new Set(tenants.map(tenant => tenant.id));
  const keys = new Set(tenants.map(tenant => tenant.apiKey));
  if (ids.size !== tenants.length) throw new Error('Tenant ids must be unique');
  if (keys.size !== tenants.length) throw new Error('Each tenant needs its own API key');
  return tenants;
}

export function readTenantsFile(path: string, env: NodeJS.ProcessEnv = process.env): Tenant[] {
  return parseTenants(JSON.parse(fs.readFileSync(path, 'utf8')), env);
}

/** The tenant a service API key belongs to. Every key is compared, in constant time. */
export function tenantForKey(tenants: Tenant[], key: string): Tenant | undefined {
  let found: Tenant | undefined;
  for (const tenant of tenants) if (matchesSecret(key, tenant.apiKey)) found = tenant;
  return found;
}

export function sourceLocation(tenant: Tenant, modality?: Modality): StorageLocation {
  const location = tenant.sources[modality ?? 'default'];
  if (!location) throw new Error('Modality storage has not been configured');
  return location;
}

/** Every origin any tenant allows to embed the viewer, for the page's frame-ancestors. */
export function frameAncestors(tenants: Tenant[], extra?: string): string | undefined {
  const origins = new Set([...(extra?.split(/\s+/).filter(Boolean) ?? []), ...tenants.flatMap(tenant => tenant.frameAncestors)]);
  return origins.size ? [...origins].join(' ') : undefined;
}
