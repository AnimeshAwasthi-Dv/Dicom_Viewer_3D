# Portal API integration

The viewer opens studies already stored in private S3. Your portal calls the viewer from its backend, then opens the returned `viewerUrl` in the clinician's browser. No file upload or AWS credentials are needed in the portal-to-viewer request.

## Backend configuration

```dotenv
DICOM_VIEWER_API_URL=https://dicom.admindectrocel.online
DICOM_VIEWER_API_KEY=<same value as SERVICE_API_KEY on the viewer server>
```

These are portal backend settings. The viewer itself still uses `PUBLIC_URL` and `SERVICE_API_KEY`. Adding environment variables alone does not wire a portal button: the portal must call the API below. Never put the service key in browser JavaScript, a URL, or a `VITE_*` variable. The portal must authenticate its user and verify access to the selected study before making these calls.

## Request a viewer link

```http
POST https://dicom.admindectrocel.online/api/v1/viewer-links
Authorization: Bearer <DICOM_VIEWER_API_KEY>
Content-Type: application/json

{"sourcePrefix":"test/hospitals/HOSPITAL/STUDY/"}
```

Replace `HOSPITAL/STUDY` with the actual S3 path. The folder is listed recursively and can contain ZIPs, DICOM, JPG, JPEG and PNG files. Supply exactly one selector:

| Selection | Request body |
| --- | --- |
| Study folder | `{"sourcePrefix":"test/hospitals/HOSPITAL/STUDY/"}` |
| One ZIP | `{"zipKey":"test/hospitals/HOSPITAL/STUDY/scan.zip"}` |
| Individual files or a mixture | `{"objectKeys":["test/studies/STUDY/scan.zip","test/studies/STUDY/photo.jpg","test/studies/STUDY/image.png"]}` |

Use object keys, not `s3://` or signed URLs. Allowed roots are `test/hospitals/` and `test/studies/`. Folder requests must name a study subfolder, not an entire root. Optional `modality` accepts `CT`, `MRI`, `XRAY` or `MAMMOGRAPHY`.

For a new or ongoing import the API responds **202 Accepted**, with `Retry-After: 2`:

```json
{
  "studyId": "<study-id>",
  "status": "queued",
  "statusUrl": "/api/v1/studies/<study-id>",
  "reused": false,
  "retryAfterSeconds": 2
}
```

Poll `GET /api/v1/studies/<study-id>` every two seconds with the same authorization header. Continue while status is `waiting`, `queued`, `active` or `delayed`. Stop and show an import error for `failed`; do not retry failed imports in an unbounded loop. If `completed`, call:

```http
POST /api/v1/sessions
Authorization: Bearer <DICOM_VIEWER_API_KEY>
Content-Type: application/json

{"studyId":"<study-id>"}
```

This returns **201 Created** with `viewerUrl`, `id` (session ID), `studyId`, `expiresAt` (Unix milliseconds), `revision` and `state`. If the study was already indexed, the initial `POST /api/v1/viewer-links` returns those fields immediately, plus `status: "ready"` and `reused: true`.

Open the full `viewerUrl`, preserving its `#token=...` fragment. It is an expiring bearer link; do not put it into public logs. Default session lifetime is one hour. Each ready link request creates a separate session; imports of unchanged source objects are reused. The portal can save the imported study ID and create later sessions directly with `/api/v1/sessions`. Re-submit the source selection to detect changed source objects. Explicitly submitting a failed selection again queues a retry.

An import with skipped files exposes `manifest.skippedFiles` through its study status response. Inspect it when validating study completeness. The viewer does not infer patient ownership from S3 folder names.

| HTTP status | Action |
| --- | --- |
| 400 | Fix the source selection or request body. |
| 401 | Verify the portal key matches the viewer's `SERVICE_API_KEY`. |
| 404 | Check the object keys, folder contents and viewer S3 permissions. |
| 409 | A requested study is not yet ready for session creation. |
| 503 | Check viewer API/worker logs and S3 connectivity; retry with a bounded delay. |

## Optional Node.js client

Copy [viewer-client.mjs](../integrations/portal/viewer-client.mjs) into the portal backend. It uses Node's built-in fetch and timers, with no third-party dependencies; this repository targets Node.js 24+. Load the portal environment before creating the client.

```js
import { createViewerClient } from './viewer-client.mjs';

const viewer = createViewerClient();

// After the portal has authorized the user, derive this path from its study record.
const result = await viewer.requestViewerLink({
  sourcePrefix: study.storagePrefix
});

// result.status === 'ready': return result.viewerUrl to the authorized browser.
// Otherwise save result.studyId against the portal study and poll through the backend:
// await viewer.getStudy(result.studyId)
// Once completed: await viewer.createSession(result.studyId)
```

The client also provides `openStudy(source)` for CLI/background jobs. It handles import, polling and session creation, with a one-hour overall deadline. Do not hold a portal HTTP request open for an hour: use the separate methods and show progress in the portal. Pass `{ signal }` to cancel local waiting; this does not cancel the server import. HTTP errors expose `error.status`; import/overall-timeout errors expose `error.studyId` when available. `revokeSession(sessionId)` revokes a viewer session.

## Deploy and test on the viewer EC2

```bash
cd ~/dicom_viewer
git pull --ff-only origin staging-test
sudo docker compose up -d --build
curl --fail http://127.0.0.1:3000/healthz

# Replace the example with an actual study folder. The output contains a private viewer URL.
sudo docker compose exec -T \
  -e SOURCE_PREFIX='test/hospitals/HOSPITAL/STUDY/' \
  api node examples/open-study.mjs
```

The smoke-test command uses `DICOM_VIEWER_API_URL`/`DICOM_VIEWER_API_KEY` when present in the container, otherwise local port 3000 and its existing `SERVICE_API_KEY`. It tests the same API flow available to the portal. Open the printed URL to verify HTTPS and browser access to S3. Runtime images include this command and `examples/check-storage.mjs`.

The API update is on the viewer server. The portal's own backend and button still need to invoke it; pulling this repository cannot modify a separate portal application. See the [full API and deployment guide](ec2-viewer-service.md) for remote controls, S3 permissions and deployment details.
