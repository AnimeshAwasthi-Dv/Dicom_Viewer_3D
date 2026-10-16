// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createViewerClient } from './viewer-client.mjs';

const servers = [];
const apiKey = 'synthetic-service-key-for-client-tests-only';
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

async function harness(handler, options = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
    handler(req, res, calls.length);
  });
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { client: createViewerClient({ baseUrl, apiKey, ...options }), baseUrl, calls };
}
const reply = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

it('uses portal environment variables and returns an already indexed viewer link without polling', async () => {
  const session = { id: 'session-1', studyId: 'study-1', status: 'ready', viewerUrl: 'https://viewer.example.com/?session=session-1#token=synthetic' };
  const { baseUrl, calls } = await harness((_req, res) => reply(res, 201, session));
  vi.stubEnv('DICOM_VIEWER_API_URL', baseUrl);
  vi.stubEnv('DICOM_VIEWER_API_KEY', apiKey);
  const client = createViewerClient();
  expect(await client.openStudy({ zipKey: 'test/studies/case.zip' })).toEqual(session);
  expect(calls).toEqual([{ path: '/api/v1/viewer-links', method: 'POST', authorization: `Bearer ${apiKey}`, body: { zipKey: 'test/studies/case.zip' } }]);
});

it('polls the captured study ID and creates a session only after import completes', async () => {
  const { client, calls } = await harness((_req, res, count) => {
    if (count === 1) reply(res, 202, { studyId: 'study-1', status: 'queued' });
    else if (count === 2) reply(res, 200, { id: 'study-1', status: 'active' });
    else if (count === 3) reply(res, 200, { id: 'study-1', status: 'completed' });
    else reply(res, 201, { id: 'session-1', viewerUrl: 'https://viewer.example.com/#token=synthetic' });
  });
  expect(await client.openStudy({ sourcePrefix: 'test/hospitals/case/' }, { pollIntervalMs: 1 })).toMatchObject({ studyId: 'study-1', id: 'session-1' });
  expect(calls.map(call => call.path)).toEqual(['/api/v1/viewer-links', '/api/v1/studies/study-1', '/api/v1/studies/study-1', '/api/v1/sessions']);
  expect(calls[3].body).toEqual({ studyId: 'study-1' });
  expect(calls.every(call => call.authorization === `Bearer ${apiKey}`)).toBe(true);
});

it('stops on a failed import without creating a session or retrying the import', async () => {
  const { client, calls } = await harness((_req, res, count) => reply(res, count === 1 ? 202 : 200,
    count === 1 ? { studyId: 'study-1', status: 'queued' } : { status: 'failed' }));
  await expect(client.openStudy({ objectKeys: ['test/studies/photo.jpg', 'test/studies/image.png'] })).rejects.toMatchObject({ studyId: 'study-1', message: expect.stringContaining('import failed') });
  expect(calls).toHaveLength(2);
});

it('opens a progressive session as soon as the first chunk is ready', async () => {
  const { client, calls } = await harness((_req, res, count) => {
    if (count === 1) reply(res, 202, { studyId: 'study-1', status: 'queued' });
    else if (count === 2) reply(res, 200, { status: 'active', ready: true, availableInstances: 1 });
    else reply(res, 201, { id: 'session-1', importStatus: 'loading', viewerUrl: 'https://viewer.example.com/#token=synthetic' });
  });
  expect(await client.openStudy({ zipKey: 'test/studies/a.zip' })).toMatchObject({ studyId: 'study-1', importStatus: 'loading' });
  expect(calls).toHaveLength(3);
  expect(calls[2].path).toBe('/api/v1/sessions');
});

it('reports HTTP status without copying potentially sensitive response bodies', async () => {
  const { client } = await harness((_req, res) => reply(res, 401, { error: 'private-response-body' }));
  await expect(client.requestViewerLink({ zipKey: 'test/studies/case.zip' })).rejects.toMatchObject({ status: 401, message: 'Viewer API returned HTTP 401' });
});

it('bounds hanging requests and allows cancellation', async () => {
  const { client } = await harness(() => {}, { requestTimeoutMs: 30 });
  await expect(client.getStudy('study-1')).rejects.toThrow('timed out');
  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  await expect(client.openStudy({ zipKey: 'test/studies/a.zip' }, { signal: controller.signal })).rejects.toThrow('caller cancelled');
});

it('bounds polling and retains the study ID so callers can resume later', async () => {
  const { client } = await harness((_req, res) => reply(res, 202, { studyId: 'study-1', status: 'active' }));
  await expect(client.openStudy({ zipKey: 'test/studies/a.zip' }, { timeoutMs: 150, pollIntervalMs: 1000 })).rejects.toMatchObject({ studyId: 'study-1', message: expect.stringContaining('Timed out waiting') });
});

it('does not follow redirects with the service key and handles session revocation', async () => {
  const { client, calls } = await harness((req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); }
    else { res.writeHead(302, { Location: '/unexpected' }); res.end(); }
  });
  await expect(client.getStudy('study-1')).rejects.toThrow('request failed');
  expect(calls).toHaveLength(1);
  expect(await client.revokeSession('session-1')).toBeUndefined();
  expect(calls[1].method).toBe('DELETE');
});

it('rejects unsafe configuration and ambiguous selections before sending requests', () => {
  expect(() => createViewerClient({ baseUrl: 'http://example.com', apiKey })).toThrow('HTTPS origin');
  expect(() => createViewerClient({ baseUrl: 'https://example.com/api', apiKey })).toThrow('HTTPS origin');
  expect(() => createViewerClient({ baseUrl: 'https://example.com', apiKey: 'short' })).toThrow('SERVICE_API_KEY');
  const client = createViewerClient({ baseUrl: 'https://example.com', apiKey });
  expect(() => client.requestViewerLink({ zipKey: 'a.zip', sourcePrefix: 'folder/' })).toThrow('exactly one');
});
