import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
    async put(key: string, body: Uint8Array | string, contentType: string) {
      await client.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
    },
    async sign(key: string) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: 300 });
    }
  };
}
