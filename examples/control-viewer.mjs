// Run on the portal server: API_BASE=https://viewer.example.com SERVICE_API_KEY=... ZIP_KEY=CT/example.zip node examples/control-viewer.mjs
const { API_BASE, SERVICE_API_KEY, ZIP_KEY, MODALITY = 'CT' } = process.env;
if (!API_BASE || !SERVICE_API_KEY || !ZIP_KEY) throw new Error('Set API_BASE, SERVICE_API_KEY and ZIP_KEY');
async function request(path, method = 'GET', data) {
  const response = await fetch(new URL(path, API_BASE), {
    method,
    headers: { Authorization: `Bearer ${SERVICE_API_KEY}`, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`Viewer API returned ${response.status}: ${await response.text()}`);
  return response.json();
}
const imported = await request('/api/v1/studies', 'POST', { modality: MODALITY, zipKey: ZIP_KEY });
const deadline = Date.now() + 60 * 60 * 1000;
while (true) {
  const study = await request(`/api/v1/studies/${imported.id}`);
  if (study.status === 'completed') break;
  if (study.status === 'failed') throw new Error('Study import failed');
  if (Date.now() > deadline) throw new Error(`Import is still pending. Resume polling study ${imported.id}`);
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const session = await request('/api/v1/sessions', 'POST', { studyId: imported.id });
console.log('Study ID (save this for reuse):', imported.id);
console.log('Viewer link (private):', session.viewerUrl);
const state = session.state;
state.viewports[0].windowWidth = 1500;
state.viewports[0].windowCenter = -600;
await request(`/api/v1/sessions/${session.id}/state`, 'PUT', { expectedRevision: session.revision, state });
console.log('Requested lung window. Open the link, then GET the session to inspect lastClientStatus.');
