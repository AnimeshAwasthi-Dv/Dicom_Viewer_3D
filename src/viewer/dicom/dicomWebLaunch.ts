/** DICOMweb server root used when the link doesn't name one: the RadAgent imaging gateway's same-origin proxy. */
const DEFAULT_DICOMWEB_ROOT = '/dicom-web';

/** Parameters of a DICOMweb launch link: `?study=<StudyInstanceUID>[&dicomweb=<root>]`. */
export function dicomWebLaunch(search = window.location.search): { studyInstanceUID: string; root: string } | undefined {
  const params = new URLSearchParams(search);
  const studyInstanceUID = params.get('study') ?? params.get('StudyInstanceUIDs')?.split(',')[0];
  if (!studyInstanceUID) return undefined;
  const requested = params.get('dicomweb');
  // Only same-origin roots: the session cookie that scopes access must never be sent elsewhere.
  const root = requested && new URL(requested, window.location.href).origin === window.location.origin ? requested : DEFAULT_DICOMWEB_ROOT;
  return { studyInstanceUID, root };
}
