// Read-only check. Run: node --env-file=.env examples/check-storage.mjs
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const { AWS_REGION, S3_BUCKET, S3_SOURCE_PREFIX, S3_ADDITIONAL_SOURCE_PREFIXES = '' } = process.env;
if (!AWS_REGION || !S3_BUCKET || !S3_SOURCE_PREFIX) throw new Error('Set AWS_REGION, S3_BUCKET and S3_SOURCE_PREFIX');
const client = new S3Client({ region: AWS_REGION });
try {
  for (const prefix of [S3_SOURCE_PREFIX, ...S3_ADDITIONAL_SOURCE_PREFIXES.split(',').map(value => value.trim()).filter(Boolean)]) {
    const result = await client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, MaxKeys: 1 }));
    console.log(JSON.stringify({ bucket: S3_BUCKET, region: AWS_REGION, prefix, listing: 'ok', hasObjects: (result.KeyCount ?? 0) > 0 }));
  }
} catch (error) {
  // SDK error messages can contain request details; report only the type and HTTP status.
  console.error(JSON.stringify({ check: 'failed', error: error.name, status: error.$metadata?.httpStatusCode }));
  process.exitCode = 1;
} finally { client.destroy(); }
