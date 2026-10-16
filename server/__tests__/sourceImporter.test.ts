// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { importS3Study } from '../sourceImporter';
import { objectVersion } from '../sources';
import { config, dicomFile } from './fixtures';

describe('S3 study import', () => {
  function setup() {
    const data = dicomFile();
    const body = Readable.from([data]);
    const response = { Body: body, ETag: '"version-1"', ContentLength: data.length };
    const send = vi.fn(async (_command: GetObjectCommand) => response);
    const client = { send: send as unknown as S3Client['send'] };
    const write = vi.fn(async () => undefined);
    const job = { id: 'test-import', objects: [{ key: 'studies/scan.dcm', version: objectVersion(response) }] };
    return { client, send, write, job, body };
  }
  it('reads selected keys and writes the manifest only after all frames succeed', async () => {
    const { client, send, write, job } = setup();
    expect(await importS3Study(config, client, job, write, async () => undefined)).toEqual({ instances: 1, skippedFiles: 0 });
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'studies/scan.dcm' });
    expect(write).toHaveBeenLastCalledWith('derived/test-import/manifest.json', expect.any(Buffer), 'application/json');
  });
  it('rejects sources overwritten after the API snapshot without publishing a manifest', async () => {
    const { client, write, job, body } = setup();
    job.objects[0].version = 'older-version';
    await expect(importS3Study(config, client, job, write, async () => undefined)).rejects.toThrow('Source changed');
    expect(body.destroyed).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
  it('rechecks allowed prefixes in the worker before fetching any object', async () => {
    const { client, send, write, job } = setup();
    job.objects[0].key = 'reports/scan.dcm';
    await expect(importS3Study(config, client, job, write, async () => undefined)).rejects.toThrow('outside allowed');
    expect(send).not.toHaveBeenCalled();
  });
});
