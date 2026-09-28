import express from 'express';
import compression from 'compression';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Config } from './config';
import { frameAncestors, sourceLocation, tenantForKey, MODALITIES, type Modality, type Tenant } from './tenants';
import { digest, matchesSecret, snapshot, type Sessions, type SessionRecord } from './sessions';
import { remoteStateSchema, type StudyManifest } from '../src/types/remote';
import { initialState, validateState } from './validation';

export interface ApiDependencies {
  config: Config;
  tenants: Tenant[];
  sessions: Sessions;
  manifest(tenant: Tenant, id: string): Promise<StudyManifest>;
  sign(tenant: Tenant, key: string): Promise<string>;
  /** The source object's version (ETag, plus VersionId when versioning is on), or undefined when it doesn't exist. */
  sourceVersion(tenant: Tenant, bucket: string, key: string): Promise<string | undefined>;
  enqueue(tenant: Tenant, id: string, zipKey: string, modality?: Modality): Promise<void>;
  /** The import job of this tenant's study, or undefined when there is none (or it belongs to another tenant). */
  job(tenant: Tenant, id: string): Promise<{ status: string; progress: unknown } | undefined>;
  publish(id: string): Promise<void>;
  subscribe(id: string, notify: () => void): () => void;
  healthy(): boolean;
}
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const idSchema = z.uuid();
const bearer = (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : '';

// Change this only when the representation of derived frames changes. It makes
// existing source archives import into a new, isolated derived prefix instead
// of reusing an incompatible (or less efficient) prior representation.
// cs3d-v1: imports keep compressed (JPEG, JPEG Lossless, RLE, HTJ2K…), colour and multi-frame images, which
// earlier imports skipped because the viewer could not decode them.
const DERIVED_FRAME_FORMAT_VERSION = 'cs3d-v1';

/**
 * The import ID for one version of one source ZIP. Asking to import the same archive again returns the study already
 * extracted from it instead of unpacking it again; replacing the ZIP (a new ETag), or changing the
 * derived-frame format, gives a new ID and a fresh import.
 */
export function studyIdFor(tenantId: string, bucket: string, key: string, version: string): string {
  // The tenant is part of the identity: two tenants' stores can hold the same bucket and key names.
  const hex = createHash('sha256').update(`${DERIVED_FRAME_FORMAT_VERSION}\n${tenantId}\n${bucket}\n${key}\n${version}`).digest('hex');
  // Shaped as an RFC 9562 version 8 (custom) UUID so it passes the same validation as other IDs.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Scripts only from this origin, never inline. 'unsafe-eval' is required by the image decoders: Cornerstone's
 * Emscripten codec builds (JPEG-LS among them) generate their bindings with `new Function`, and fail without it (the
 * RadAgent imaging gateway allows it for the same reason). Images come from the tenants' stores through signed URLs:
 * any HTTPS origin, plus `storageOrigins` (tenant endpoints, which may be plain HTTP inside a private network).
 * `frameAncestors` limits which sites may embed the viewer, against clickjacking.
 */
export function contentSecurityPolicy(frameAncestors?: string, storageOrigins: string[] = []): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' https:${storageOrigins.map(origin => ` ${origin}`).join('')}`,
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    ...(frameAncestors ? [`frame-ancestors ${frameAncestors}`] : [])
  ].join('; ');
}

export function createApp(deps: ApiDependencies) {
  const { config, sessions, tenants } = deps;
  const ancestors = frameAncestors(tenants, config.FRAME_ANCESTORS);
  const storageOrigins = [...new Set(tenants.flatMap(tenant => tenant.storage.endpoint ? [new URL(tenant.storage.endpoint).origin] : []))];
  const tenantById = new Map(tenants.map(tenant => [tenant.id, tenant]));
  const app = express();
  app.disable('x-powered-by');
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/events') && compression.filter(req, res) }));
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(ancestors, storageOrigins));
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '1mb' }));
  app.get('/healthz', (_req, res) => res.status(deps.healthy() ? 200 : 503).json({ ready: deps.healthy() }));
  const service: RequestHandler = (req, res, next) => {
    const tenant = tenantForKey(tenants, bearer(req.headers.authorization));
    if (!tenant) throw new HttpError(401, 'Invalid service credentials');
    res.locals.tenant = tenant;
    next();
  };
  const viewer: RequestHandler = async (req, res, next) => {
    const session = await sessions.get(idSchema.parse(req.params.id));
    const tenant = session && tenantById.get(session.tenantId);
    if (!session || !tenant || !matchesSecret(digest(bearer(req.headers.authorization)), session.tokenHash)) throw new HttpError(401, 'Viewer session expired or invalid');
    res.locals.session = session;
    res.locals.tenant = tenant;
    next();
  };
  // Another tenant's session is reported as missing, not forbidden: its existence isn't theirs to learn.
  const getSession = async (tenant: Tenant, id: unknown) => {
    const session = await sessions.get(idSchema.parse(id));
    if (!session || session.tenantId !== tenant.id) throw new HttpError(404, 'Session not found or expired');
    return session;
  };
  const readyManifest = async (tenant: Tenant, id: string) => {
    const job = await deps.job(tenant, id);
    if (!job) throw new HttpError(404, 'Study not found');
    if (job.status !== 'completed') throw new HttpError(409, 'Study import is not complete');
    return deps.manifest(tenant, id);
  };

  app.post('/api/v1/studies', service, async (req, res) => {
    const tenant = res.locals.tenant as Tenant;
    const { zipKey, modality } = z.object({ zipKey: z.string().min(1).max(1024), modality: z.enum(MODALITIES).optional() }).strict().parse(req.body);
    let location;
    try { location = sourceLocation(tenant, modality); } catch { throw new HttpError(400, 'Modality storage has not been configured'); }
    if (!zipKey.startsWith(location.prefix) || !zipKey.toLowerCase().endsWith('.zip')) throw new HttpError(400, 'ZIP key must be within the configured modality prefix and end in .zip');
    const version = await deps.sourceVersion(tenant, location.bucket, zipKey);
    if (!version) throw new HttpError(404, 'ZIP not found');
    const id = studyIdFor(tenant.id, location.bucket, zipKey, version);
    const statusUrl = `/api/v1/studies/${id}`;
    const existing = await deps.job(tenant, id);
    // Already imported or importing: reuse it. Only a failed import runs again.
    if (existing && existing.status !== 'failed') {
      res.status(200).json({ id, status: existing.status, reused: true, statusUrl });
      return;
    }
    await deps.enqueue(tenant, id, zipKey, modality);
    res.status(202).json({ id, status: 'queued', reused: false, statusUrl });
  });
  app.get('/api/v1/studies/:id', service, async (req, res) => {
    const tenant = res.locals.tenant as Tenant;
    const id = idSchema.parse(req.params.id);
    const job = await deps.job(tenant, id);
    if (!job) throw new HttpError(404, 'Study not found');
    const manifest = job.status === 'completed' ? await deps.manifest(tenant, id) : undefined;
    res.json({ id, ...job, ...(job.status === 'failed' ? { error: 'Import failed; check the import worker logs' } : {}), ...(manifest ? { manifest: { ...manifest, instances: manifest.instances.map(({ metadata }) => ({ metadata })) } } : {}) });
  });
  app.post('/api/v1/sessions', service, async (req, res) => {
    const tenant = res.locals.tenant as Tenant;
    const { studyId } = z.object({ studyId: idSchema }).strict().parse(req.body);
    const manifest = await readyManifest(tenant, studyId);
    const { session, token } = await sessions.create(tenant.id, studyId, initialState(manifest), config.SESSION_TTL_SECONDS);
    const url = new URL(config.PUBLIC_URL);
    url.searchParams.set('session', session.id);
    url.hash = `token=${token}`;
    res.status(201).json({ ...snapshot(session), viewerUrl: url.toString() });
  });
  app.get('/api/v1/sessions/:id', service, async (req, res) => {
    const session = await getSession(res.locals.tenant as Tenant, req.params.id);
    const status = await sessions.status(session.id);
    res.json({ ...snapshot(session), lastClientStatus: status ? JSON.parse(status) : null });
  });
  app.put('/api/v1/sessions/:id/state', service, async (req, res) => {
    const tenant = res.locals.tenant as Tenant;
    const session = await getSession(tenant, req.params.id);
    const input = z.object({ expectedRevision: z.number().int().min(0), studyId: idSchema.optional(), state: remoteStateSchema }).strict().parse(req.body);
    const studyId = input.studyId ?? session.studyId;
    const manifest = await readyManifest(tenant, studyId);
    if (!validateState(input.state, manifest)) throw new HttpError(400, 'Unknown series, out-of-range slice, or measurement outside the study');
    const revision = await sessions.update(session.id, input.expectedRevision, studyId, input.state);
    if (revision === -1) throw new HttpError(404, 'Session expired');
    if (revision === -2) throw new HttpError(409, 'Revision conflict; retrieve the latest session and retry');
    // State is committed before notification; stream heartbeats recover missed notifications.
    await deps.publish(session.id).catch(() => undefined);
    res.json({ revision, status: 'accepted' });
  });
  app.delete('/api/v1/sessions/:id', service, async (req, res) => {
    const session = await getSession(res.locals.tenant as Tenant, req.params.id);
    await sessions.remove(session.id);
    await deps.publish(session.id).catch(() => undefined);
    res.sendStatus(204);
  });

  app.get('/api/viewer/:id/manifest', viewer, async (_req, res) => {
    const session = res.locals.session as SessionRecord;
    const manifest = await deps.manifest(res.locals.tenant as Tenant, session.studyId);
    res.json({ ...manifest, instances: manifest.instances.map(({ metadata, previewKey }) => ({ metadata, ...(previewKey ? { preview: true } : {}) })) });
  });
  app.post('/api/viewer/:id/frames', viewer, async (req, res) => {
    const { instanceIds } = z.object({ instanceIds: z.array(z.string().max(128)).min(1).max(32) }).strict().parse(req.body);
    const session = res.locals.session as SessionRecord;
    const tenant = res.locals.tenant as Tenant;
    const manifest = await deps.manifest(tenant, session.studyId);
    const entries = new Map(manifest.instances.map(entry => [entry.metadata.sopInstanceUID, entry]));
    const selected = instanceIds.map(id => {
      const entry = entries.get(id);
      if (!entry) throw new HttpError(404, 'Instance not in this session study');
      return entry;
    });
    res.json({ expiresAt: Date.now() + 300000, frames: await Promise.all(selected.map(async entry => ({
      id: entry.metadata.sopInstanceUID,
      url: await deps.sign(tenant, entry.key),
      ...(entry.previewKey ? { previewUrl: await deps.sign(tenant, entry.previewKey) } : {})
    }))) });
  });
  app.post('/api/viewer/:id/status', viewer, async (req, res) => {
    const session = res.locals.session as SessionRecord;
    const input = z.object({ clientId: idSchema, appliedRevision: z.number().int().min(-1), state: remoteStateSchema.optional(), error: z.string().max(200).optional() }).strict().parse(req.body);
    if (input.appliedRevision > session.revision) throw new HttpError(400, 'Revision has not been issued');
    await sessions.status(session.id, JSON.stringify({ ...input, seenAt: Date.now() }));
    res.sendStatus(204);
  });
  app.get('/api/viewer/:id/events', viewer, async (_req, res) => {
    const session = res.locals.session as SessionRecord;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let revision = -1;
    let busy = false;
    let dirty = false;
    const send = (message: unknown) => { if (!res.write(`${JSON.stringify(message)}\n`)) res.end(); };
    const refresh = async () => {
      if (busy) { dirty = true; return; }
      busy = true;
      try {
        do {
          dirty = false;
          const current = await sessions.get(session.id);
          if (res.destroyed || res.writableEnded) return;
          if (!current) { send({ type: 'expired' }); res.end(); return; }
          if (current.revision !== revision) {
            revision = current.revision;
            send({ type: 'state', session: snapshot(current) });
          } else send({ type: 'heartbeat' });
        } while (dirty);
      } catch { res.end(); }
      finally { busy = false; }
    };
    const unsubscribe = deps.subscribe(session.id, () => void refresh());
    const heartbeat = setInterval(() => void refresh(), 10000);
    const expiry = setTimeout(() => { send({ type: 'expired' }); res.end(); }, Math.max(1, session.expiresAt - Date.now()));
    res.on('close', () => { unsubscribe(); clearInterval(heartbeat); clearTimeout(expiry); });
    await refresh();
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));
  app.use(express.static(path.resolve('dist'), {
    index: 'index.html',
    // Built assets have content hashes in their names, so repeat visits (and every decode worker) can reuse them
    // without asking; index.html is revalidated so a deploy takes effect at once.
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  }));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid request', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Invalid JSON' }); return; }
    console.error('API request failed:', error instanceof Error ? error.name : 'Unknown error');
    res.status(503).json({ error: 'Service temporarily unavailable' });
  };
  app.use(errors);
  return app;
}
