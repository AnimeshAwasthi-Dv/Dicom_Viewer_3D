// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createStorage } from '../storage';
import { config } from './fixtures';
import type { ListObjectsV2Command, ListObjectsV2CommandOutput, S3Client } from '@aws-sdk/client-s3';

describe('S3 study-folder listing', () => {
  it('paginates within the requested prefix and ignores directory markers and empty files', async () => {
    const storage = createStorage(config);
    const send = vi.fn<(command: ListObjectsV2Command) => Promise<Partial<ListObjectsV2CommandOutput>>>();
    storage.client.send = send as unknown as S3Client['send'];
    send.mockResolvedValueOnce({ Contents: [{ Key: 'studies/case/', Size: 0 }, { Key: 'studies/case/a.dcm', Size: 10 }], IsTruncated: true, NextContinuationToken: 'next' });
    send.mockResolvedValueOnce({ Contents: [{ Key: 'studies/case/b.png', Size: 10 }], IsTruncated: false });
    expect(await storage.listSource('test-bucket', 'studies/case/', 10)).toEqual(['studies/case/a.dcm', 'studies/case/b.png']);
    expect(send.mock.calls[1][0].input).toMatchObject({ Bucket: 'test-bucket', Prefix: 'studies/case/', ContinuationToken: 'next' });
    storage.client.destroy();
  });
  it('fails instead of silently returning a partial study when the listing exceeds its limit', async () => {
    const storage = createStorage(config);
    storage.client.send = vi.fn(async () => ({ Contents: [{ Key: 'studies/a', Size: 10 }, { Key: 'studies/b', Size: 10 }] })) as unknown as S3Client['send'];
    await expect(storage.listSource('test-bucket', 'studies/', 1)).rejects.toThrow('too many');
    storage.client.destroy();
  });
});
