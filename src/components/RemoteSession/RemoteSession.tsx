import { useEffect, useState } from 'react';
import type { PublicManifest, SessionSnapshot } from '../../types/remote';
import { remoteStateSchema } from '../../types/remote';
import { useStudyStore } from '../../store/studyStore';
import { RemoteClient } from '../../viewer/remote/RemoteClient';
import { RemoteImageSource } from '../../viewer/dicom/RemoteImageSource';
import { applyRemoteState, captureRemoteState } from '../../viewer/remote/state';

export function RemoteSession(): JSX.Element | null {
  const [status, setStatus] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('session');
    if (!id) return;
    const storageKey = `viewer-token:${id}`;
    const fragmentToken = new URLSearchParams(url.hash.slice(1)).get('token');
    const token = fragmentToken ?? sessionStorage.getItem(storageKey);
    if (fragmentToken) {
      sessionStorage.setItem(storageKey, fragmentToken);
      url.hash = '';
      window.history.replaceState(null, '', url);
    }
    if (!token) { setStatus('This viewer link is missing its access token.'); return; }
    const client = new RemoteClient(id, token);
    const clientId = crypto.randomUUID();
    const abort = new AbortController();
    let source: RemoteImageSource | undefined;
    let studyId = '';
    let appliedRevision = -1;
    let latest: SessionSnapshot | undefined;
    let applyingSnapshot: SessionSnapshot | undefined;
    let applying = false;
    let sendingStatus = false;
    let lastStatus = '';
    let lastSentAt = 0;
    let errorMessage: string | undefined;

    async function reportStatus() {
      if (sendingStatus || abort.signal.aborted) return;
      const state = appliedRevision >= 0 ? remoteStateSchema.safeParse(captureRemoteState()) : undefined;
      const payload = JSON.stringify({ clientId, appliedRevision, state: state?.success ? state.data : undefined, error: errorMessage });
      if (payload === lastStatus && Date.now() - lastSentAt < 10000) return;
      sendingStatus = true;
      try {
        await client.request('status', { method: 'POST', body: payload, signal: abort.signal });
        lastStatus = payload;
        lastSentAt = Date.now();
      } catch { /* Stream reconnect handles connectivity; status is retried. */ }
      finally { sendingStatus = false; }
    }

    async function applyLatest() {
      if (applying) return;
      applying = true;
      try {
        while (latest && !abort.signal.aborted) {
          const next = latest;
          applyingSnapshot = next;
          latest = undefined;
          if (next.revision <= appliedRevision) continue;
          if (studyId !== next.studyId) {
            useStudyStore.getState().setLoading({ phase: 'Opening remote study', indexed: 0, total: 0 });
            const response = await client.request('manifest', { signal: abort.signal });
            const manifest = await response.json() as PublicManifest;
            if (abort.signal.aborted) return;
            if (manifest.id !== next.studyId) continue;
            const nextSource = new RemoteImageSource(client, manifest);
            const studies = await nextSource.getStudyMetadata();
            if (abort.signal.aborted) { nextSource.dispose(); return; }
            source?.dispose();
            source = nextSource;
            useStudyStore.getState().setSource(source, studies);
            studyId = next.studyId;
          }
          if (abort.signal.aborted) return;
          applyRemoteState(next.state);
          appliedRevision = next.revision;
          errorMessage = undefined;
          setStatus('Connected');
          void reportStatus();
        }
      } catch {
        if (!abort.signal.aborted) {
          latest ??= applyingSnapshot;
          errorMessage = 'Unable to open the requested study.';
          setStatus(errorMessage);
          useStudyStore.getState().setLoading(undefined);
          void reportStatus();
        }
      } finally { applying = false; }
    }

    async function connect() {
      while (!abort.signal.aborted) {
        try {
          setStatus(appliedRevision < 0 ? 'Connecting to study…' : 'Reconnecting…');
          const response = await client.request('events', { signal: abort.signal });
          setStatus('Connected');
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          try {
            while (!abort.signal.aborted) {
              const result = await reader.read();
              if (result.done) break;
              buffer += decoder.decode(result.value, { stream: true });
              let newline;
              while ((newline = buffer.indexOf('\n')) >= 0) {
                const message = JSON.parse(buffer.slice(0, newline)) as { type: string; session?: SessionSnapshot };
                buffer = buffer.slice(newline + 1);
                if (message.type === 'expired') {
                  setStatus('Viewer session expired or revoked.');
                  source?.dispose();
                  useStudyStore.getState().reset();
                  sessionStorage.removeItem(storageKey);
                  abort.abort();
                  return;
                }
                if (message.type === 'state' && message.session) { latest = message.session; void applyLatest(); }
              }
            }
          } finally { await reader.cancel().catch(() => undefined); }
        } catch (error) {
          if (abort.signal.aborted) return;
          if (error instanceof Error && error.message.includes('expired')) {
            setStatus(error.message);
            source?.dispose();
            useStudyStore.getState().reset();
            sessionStorage.removeItem(storageKey);
            abort.abort();
            return;
          }
          setStatus('Connection interrupted; reconnecting…');
        }
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); };
          const timer = window.setTimeout(done, 2000);
          abort.signal.addEventListener('abort', done, { once: true });
        });
      }
    }
    const interval = window.setInterval(() => { void reportStatus(); if (latest) void applyLatest(); }, 1000);
    void connect();
    return () => { abort.abort(); source?.dispose(); window.clearInterval(interval); };
  }, []);
  return status ? <div className="remote-session-status" role="status">{status}</div> : null;
}
