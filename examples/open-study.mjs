// Run inside the viewer container, or on a Node.js portal backend.
import { createViewerClient } from '../integrations/portal/viewer-client.mjs';

try {
  const { ZIP_KEY, SOURCE_PREFIX, OBJECT_KEYS_JSON, MODALITY } = process.env;
  if ([ZIP_KEY, SOURCE_PREFIX, OBJECT_KEYS_JSON].filter(Boolean).length !== 1) {
    throw new Error('Set exactly one of ZIP_KEY, SOURCE_PREFIX, or OBJECT_KEYS_JSON');
  }
  const source = ZIP_KEY ? { zipKey: ZIP_KEY } : SOURCE_PREFIX ? { sourcePrefix: SOURCE_PREFIX } : { objectKeys: JSON.parse(OBJECT_KEYS_JSON) };
  if (MODALITY) source.modality = MODALITY;
  // The CLI can also use the viewer container's existing environment.
  const viewer = createViewerClient({
    baseUrl: process.env.DICOM_VIEWER_API_URL || process.env.API_BASE || 'http://127.0.0.1:3000',
    apiKey: process.env.DICOM_VIEWER_API_KEY || process.env.SERVICE_API_KEY
  });
  const session = await viewer.openStudy(source);
  console.log(JSON.stringify({ studyId: session.studyId, sessionId: session.id, expiresAt: session.expiresAt, viewerUrl: session.viewerUrl }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
