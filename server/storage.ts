import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config';
import type { StudyManifest } from '../src/types/remote';
import { listedObjectVersion, objectVersion, type SourceObject } from './sources';

export function createStorage(config: Config) {
  const client = new S3Client({ region: config.AWS_REGION });
  async function listObjects(bucket: string, prefix: string, maxEntries: number) {
    const objects: Array<{ Key: string; ETag?: string; Size?: number }> = [];
    let scanned = 0;
    let token: string | undefined;
    do {
      const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
      for (const object of result.Contents ?? []) {
        if (++scanned > maxEntries) throw new Error('Source prefix contains too many objects; select a smaller study folder');
        if (object.Key && !object.Key.endsWith('/') && (object.Size ?? 0) > 0) objects.push({ Key: object.Key, ETag: object.ETag, Size: object.Size });
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
      if (result.IsTruncated && !token) throw new Error('Incomplete S3 listing');
    } while (token);
    return objects;
  }
  return {
    client,
    async manifest(id: string): Promise<StudyManifest> {
      const result = await client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: `${config.S3_DERIVED_PREFIX}${id}/manifest.json` }));
      return JSON.parse(await result.Body!.transformToString()) as StudyManifest;
    },
    async put(key: string, body: Uint8Array | string, contentType: string, contentEncoding?: string) {
      await client.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ContentEncoding: contentEncoding }));
    },
    async sourceVersion(bucket: string, key: string): Promise<string | undefined> {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return objectVersion(head);
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || status === 403) return undefined;
        throw error;
      }
    },
    async listSource(bucket: string, prefix: string, maxEntries: number): Promise<string[]> {
      return (await listObjects(bucket, prefix, maxEntries)).map(object => object.Key);
    },
    async listSourceObjects(bucket: string, prefix: string, maxEntries: number): Promise<SourceObject[]> {
      return (await listObjects(bucket, prefix, maxEntries)).map(object => ({ key: object.Key, version: listedObjectVersion(object) }));
    },
    async sign(key: string) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: 300 });
    }
  };
}
