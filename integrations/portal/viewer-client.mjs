// Server-side Node.js client. Never import this module into a browser bundle.
import { setTimeout as delay } from 'node:timers/promises';

export class ViewerApiError extends Error {
  constructor(message, { status, studyId } = {}) {
    super(message);
    this.name = 'ViewerApiError';
    this.status = status;
    this.studyId = studyId;
  }
}

/** Reads the portal's environment by default; no additional packages required. */
export function createViewerClient({
  baseUrl = process.env.DICOM_VIEWER_API_URL,
  apiKey = process.env.DICOM_VIEWER_API_KEY,
  requestTimeoutMs = 300_000
} = {}) {
  if (!baseUrl) throw new Error('Set DICOM_VIEWER_API_URL on the portal backend');
  const origin = new URL(baseUrl);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('DICOM_VIEWER_API_URL must be an HTTPS origin (HTTP is allowed on localhost)');
  }
  if (!apiKey || apiKey.trim().length < 32) throw new Error('Set DICOM_VIEWER_API_KEY to the viewer SERVICE_API_KEY');
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('requestTimeoutMs must be a positive integer');

  async function request(path, method, body, signal) {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    try {
      const response = await fetch(new URL(path, origin), {
        method,
        redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      if (!response.ok) {
        // Do not echo response bodies: they may contain study information or upstream secrets.
        await response.body?.cancel();
        throw new ViewerApiError(`Viewer API returned HTTP ${response.status}`, { status: response.status });
      }
      return response.status === 204 ? undefined : await response.json();
    } catch (error) {
      if (error instanceof ViewerApiError) throw error;
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted) throw new ViewerApiError('Viewer API request timed out');
      throw new ViewerApiError('Viewer API request failed; check the URL, TLS and network access');
    }
  }

  function sourceRequest(path, source, { signal } = {}) {
    if (!source || typeof source !== 'object' ||
        ['zipKey', 'objectKeys', 'sourcePrefix'].filter(key => source[key] !== undefined).length !== 1) {
      throw new Error('Supply exactly one of zipKey, objectKeys, or sourcePrefix');
    }
    return request(path, 'POST', source, signal);
  }
  const importStudy = (source, options) => sourceRequest('/api/v1/studies', source, options);
  const requestViewerLink = (source, options) => sourceRequest('/api/v1/viewer-links', source, options);
  const getStudy = (studyId, { signal } = {}) => request(`/api/v1/studies/${encodeURIComponent(studyId)}`, 'GET', undefined, signal);
  const createSession = (studyId, { signal } = {}) => request('/api/v1/sessions', 'POST', { studyId }, signal);
  const revokeSession = (sessionId, { signal } = {}) => request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, 'DELETE', undefined, signal);

  /** For background jobs/CLI. For HTTP routes, use the separate methods to avoid long requests. */
  async function openStudy(source, { pollIntervalMs = 2000, timeoutMs = 3_600_000, signal } = {}) {
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('Polling interval and timeout must be positive integers');
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let studyId;
    try {
      const link = await requestViewerLink(source, { signal: combined });
      studyId = link.studyId;
      if (link.status === 'ready') return link;
      for (;;) {
        const study = await getStudy(studyId, { signal: combined });
        if (study.status === 'completed') return { ...await createSession(studyId, { signal: combined }), studyId };
        if (study.status === 'failed') throw new ViewerApiError('Study import failed; check the viewer worker logs', { studyId });
        await delay(pollIntervalMs, undefined, { signal: combined });
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (deadline.aborted) throw new ViewerApiError('Timed out waiting for the study; the server import may still be running', { studyId });
      throw error;
    }
  }

  return { requestViewerLink, importStudy, getStudy, createSession, revokeSession, openStudy };
}
