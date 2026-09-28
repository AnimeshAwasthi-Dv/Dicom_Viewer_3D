// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readTenants } from '../config';
import { createStorage } from '../storage';
import { frameAncestors, parseTenants, sourceLocation, tenantForKey } from '../tenants';
import { config, tenants } from './fixtures';

const file = {
  tenants: [
    {
      id: 'decxpert', apiKey: 'env:DECXPERT_KEY', storage: { region: 'ap-south-1' },
      sources: { CT: { bucket: 'decxpert-studies', prefix: 'CT/' }, MRI: { bucket: 'decxpert-mri', prefix: 'MRI/' } },
      derived: { bucket: 'decxpert-studies', prefix: 'viewer-derived/' }, frameAncestors: ['https://marengo.example.com']
    },
    {
      id: 'radagent', apiKey: 'env:RADAGENT_KEY',
      storage: { endpoint: 'https://account.r2.cloudflarestorage.com', accessKeyId: 'env:R2_KEY', secretAccessKey: 'env:R2_SECRET' },
      sources: { default: { bucket: 'radagent-scans', prefix: 'imaging/' } },
      derived: { bucket: 'radagent-scans', prefix: 'viewer-derived/' }, frameAncestors: ['https://radagent.example.com']
    }
  ]
};
const env = { DECXPERT_KEY: 'd'.repeat(40), RADAGENT_KEY: 'r'.repeat(40), R2_KEY: 'key-id', R2_SECRET: 'secret' };

describe('tenant configuration', () => {
  it('reads secrets from the environment and defaults R2 to region auto with path-style addressing', () => {
    const [decxpert, radagent] = parseTenants(file, env);
    expect(decxpert.apiKey).toBe(env.DECXPERT_KEY);
    expect(decxpert.storage).toEqual({ endpoint: undefined, region: 'ap-south-1', credentials: undefined, forcePathStyle: false });
    expect(radagent.storage).toEqual({ endpoint: 'https://account.r2.cloudflarestorage.com', region: 'auto', credentials: { accessKeyId: 'key-id', secretAccessKey: 'secret' }, forcePathStyle: true });
  });

  it('routes a request to the source of its modality, or the default one', () => {
    const [decxpert, radagent] = parseTenants(file, env);
    expect(sourceLocation(decxpert, 'MRI')).toEqual({ bucket: 'decxpert-mri', prefix: 'MRI/' });
    expect(() => sourceLocation(decxpert)).toThrow('not been configured');
    expect(sourceLocation(radagent)).toEqual({ bucket: 'radagent-scans', prefix: 'imaging/' });
  });

  it('finds the tenant of an API key, and none for an unknown key', () => {
    const parsed = parseTenants(file, env);
    expect(tenantForKey(parsed, env.RADAGENT_KEY)?.id).toBe('radagent');
    expect(tenantForKey(parsed, 'x'.repeat(40))).toBeUndefined();
  });

  it('rejects unsafe or ambiguous setups', () => {
    const one = file.tenants[1];
    expect(() => parseTenants(file, { ...env, RADAGENT_KEY: env.DECXPERT_KEY })).toThrow('own API key');
    expect(() => parseTenants({ tenants: [{ ...one, apiKey: 'short-key' }] }, env)).toThrow('at least 32');
    expect(() => parseTenants(file, { ...env, R2_SECRET: '' })).toThrow('R2_SECRET');
    expect(() => parseTenants({ tenants: [{ ...one, storage: { endpoint: one.storage.endpoint } }] }, env)).toThrow('needs its own access keys');
    expect(() => parseTenants({ tenants: [{ ...one, derived: { bucket: 'radagent-scans', prefix: 'imaging/derived/' } }] }, env)).toThrow('must not overlap');
  });

  it('lets each tenant\'s portal embed the viewer', () => {
    expect(frameAncestors(parseTenants(file, env))).toBe('https://marengo.example.com https://radagent.example.com');
    expect(frameAncestors([], undefined)).toBeUndefined();
  });

  it('keeps the single-product .env working as the "default" tenant', () => {
    const [legacy] = readTenants({ ...config, S3_MRI_STUDIES_BUCKET: 'mri-bucket', S3_MRI_STUDIES_PREFIX: 'MRI' });
    expect(legacy.id).toBe('default');
    expect(legacy.apiKey).toBe(config.SERVICE_API_KEY);
    expect(legacy.sources).toEqual({ default: { bucket: 'test-bucket', prefix: 'studies/' }, MRI: { bucket: 'mri-bucket', prefix: 'MRI/' } });
    expect(legacy.derived).toEqual({ bucket: 'test-bucket', prefix: 'derived/' });
  });
});

describe('R2 storage', () => {
  it('signs browser downloads against the R2 endpoint, path-style, for the tenant\'s derived bucket', async () => {
    const storage = createStorage(tenants[1]);
    const url = new URL(await storage.sign('viewer-derived/study/instances/abc.dcm'));
    expect(url.origin).toBe('https://account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/radagent-scans/viewer-derived/study/instances/abc.dcm');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^a\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(storage.studyPrefix('study')).toBe('viewer-derived/study/');
  });
});
