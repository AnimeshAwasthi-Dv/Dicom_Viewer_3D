// Run on the portal server. Set SERVICE_API_KEY and exactly one of ZIP_KEY, SOURCE_PREFIX, OBJECT_KEYS_JSON.
const { API_BASE = 'https://dicom.admindectrocel.online', SERVICE_API_KEY, ZIP_KEY, SOURCE_PREFIX, OBJECT_KEYS_JSON, MODALITY } = process.env;
if (!SERVICE_API_KEY || [ZIP_KEY, SOURCE_PREFIX, OBJECT_KEYS_JSON].filter(Boolean).length !== 1) throw new Error('Set SERVICE_API_KEY and exactly one of ZIP_KEY, SOURCE_PREFIX, OBJECT_KEYS_JSON');
async function request(path, method = 'GET', data) {
  const response = await fetch(new URL(path, API_BASE), {
    method,
    headers: { Authorization: `Bearer ${SERVICE_API_KEY}`, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`Viewer API returned ${response.status}: ${await response.text()}`);
  return response.json();
}
const source = ZIP_KEY ? { zipKey: ZIP_KEY } : SOURCE_PREFIX ? { sourcePrefix: SOURCE_PREFIX } : { objectKeys: JSON.parse(OBJECT_KEYS_JSON) };
const imported = await request('/api/v1/studies', 'POST', { ...source, ...(MODALITY ? { modality: MODALITY } : {}) });
const deadline = Date.now() + 60 * 60 * 1000;
while (true) {
  const study = await request(`/api/v1/studies/${imported.id}`);
  if (study.status === 'failed') throw new Error('Study import failed');
  if (study.ready || study.status === 'completed') break;
  if (Date.now() > deadline) throw new Error(`Import is still pending. Resume polling study ${imported.id}`);
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const session = await request('/api/v1/sessions', 'POST', { studyId: imported.id });
console.log('Study ID (save this for reuse):', imported.id);
console.log('Viewer link (private):', session.viewerUrl);
console.log('Open the link, then GET the session to inspect lastClientStatus.');
