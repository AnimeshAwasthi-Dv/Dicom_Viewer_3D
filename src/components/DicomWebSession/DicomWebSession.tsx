import { useEffect } from 'react';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { DicomWebImageSource } from '../../viewer/dicom/DicomWebImageSource';
import { choosePrimarySeries } from '../../viewer/study/StudyManager';
import { dicomWebLaunch } from '../../viewer/dicom/dicomWebLaunch';

/**
 * Opens a study from a DICOMweb server (Orthanc behind the RadAgent imaging gateway). The gateway has already
 * redeemed the one-time launch code and scoped this browser's session cookie to exactly this study.
 */
export function DicomWebSession(): null {
  useEffect(() => {
    const launch = dicomWebLaunch();
    if (!launch) return;
    let cancelled = false;
    const source = new DicomWebImageSource(launch.root, launch.studyInstanceUID);
    const { setLoading, setSource, addError, selectSeries } = useStudyStore.getState();
    setLoading({ phase: 'Opening study', indexed: 0, total: 0 });
    void (async () => {
      const studies = await source.getStudyMetadata();
      if (cancelled) return;
      setSource(source, studies);
      // The series with the most images (CT/MR first) opens first; its instance list loads before anything else.
      const primary = choosePrimarySeries(studies);
      if (!primary) throw new Error('This study has no displayable series.');
      selectSeries(primary.id);
      useViewerStore.getState().assignSeries('viewport-1', primary.id);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setLoading(undefined);
      addError(error instanceof Error ? error.message : 'Unable to open this study.');
    });
    return () => { cancelled = true; source.dispose(); };
  }, []);
  return null;
}
