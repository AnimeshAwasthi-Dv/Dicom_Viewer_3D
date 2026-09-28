import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { StudyManifest } from '../src/types/remote';
import type { Tenant } from './tenants';

export type Storage = ReturnType<typeof createStorage>;

/** An S3 client for the tenant's store: AWS S3, or an S3-compatible endpoint such as Cloudflare R2. */
export function s3Client(tenant: Tenant): S3Client {
  const { endpoint, region, credentials, forcePathStyle } = tenant.storage;
  return new S3Client({
    region,
    endpoint,
    credentials,
    forcePathStyle,
    // R2 and other S3-compatible stores don't all implement the newer default checksums.
    ...(endpoint ? { requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const } : {})
  });
}

/** One tenant's objects: its source ZIPs, and the derived instances and study index the viewer reads. */
export function createStorage(tenant: Tenant, client = s3Client(tenant)) {
  const { bucket, prefix } = tenant.derived;
  return {
    client,
    /** Prefix derived objects of one study are written under. */
    studyPrefix: (id: string) => `${prefix}${id}/`,
    async manifest(id: string): Promise<StudyManifest> {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${id}/manifest.json` }));
      return JSON.parse(await result.Body!.transformToString()) as StudyManifest;
    },
    async put(key: string, body: Uint8Array | string, contentType: string, contentEncoding?: string) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentEncoding: contentEncoding }));
    },
    async source(sourceBucket: string, key: string): Promise<{ body: Readable; size?: number }> {
      const result = await client.send(new GetObjectCommand({ Bucket: sourceBucket, Key: key }));
      return { body: result.Body as Readable, size: result.ContentLength };
    },
    async sourceVersion(sourceBucket: string, key: string): Promise<string | undefined> {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: sourceBucket, Key: key }));
        return `${head.ETag ?? ''}:${head.VersionId ?? ''}:${head.ContentLength ?? 0}`;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || status === 403) return undefined;
        throw error;
      }
    },
    /** A short-lived URL the browser downloads a derived object from directly. */
    async sign(key: string) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
    }
  };
}

/** Storage of every tenant, by tenant id. */
export function createStorages(tenants: Tenant[]): Map<string, Storage> {
  return new Map(tenants.map(tenant => [tenant.id, createStorage(tenant)]));
}
