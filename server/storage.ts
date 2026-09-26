import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config';
import type { StudyManifest } from '../src/types/remote';

export function createStorage(config: Config) {
  const client = new S3Client({ region: config.AWS_REGION });
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
        return `${head.ETag ?? ''}:${head.VersionId ?? ''}:${head.ContentLength ?? 0}`;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || status === 403) return undefined;
        throw error;
      }
    },
    async sign(key: string) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: 300 });
    }
  };
}
