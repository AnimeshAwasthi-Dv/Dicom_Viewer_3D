import type { PublicManifest } from '../../types/remote';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { useUiStore } from '../../store/uiStore';
import type { RemoteImageSource } from '../dicom/RemoteImageSource';

/** Keep the displayed SOP instance when newly arrived slices change geometric sort order. */
export function refreshRemoteStudy(source: RemoteImageSource, manifest: PublicManifest): void {
  const previous = useStudyStore.getState();
  if (previous.imageSource !== source) return;
  const studies = source.updateManifest(manifest);
  const viewports = useViewerStore.getState().viewports.map(viewport => {
    const seriesId = viewport.seriesId ?? previous.selectedSeriesId;
    const oldSeries = selectCurrentSeries(previous.studies, seriesId);
    const instanceId = oldSeries?.instances[viewport.instanceIndex]?.id;
    const series = selectCurrentSeries(studies, seriesId);
    const index = series?.instances.findIndex(instance => instance.id === instanceId) ?? -1;
    return index >= 0 && index !== viewport.instanceIndex ? { ...viewport, instanceIndex: index } : viewport;
  });
  // Synchronous updates are batched by React. Do not reset source, frames, tools or measurements.
  useViewerStore.setState({ viewports });
  useStudyStore.setState({ studies, remoteImportStatus: manifest.importStatus ?? 'completed' });
  if (manifest.importStatus && manifest.importStatus !== 'completed') useUiStore.setState({ mprOpen: false });
}

export function importMessage(manifest: PublicManifest): string {
  const count = manifest.instances.length;
  if (manifest.importStatus === 'failed') return `Study incomplete: import failed. ${count} images available. Contact the portal administrator.`;
  if (manifest.importStatus === 'loading') return 'Partial study';
  return manifest.skippedFiles ? `Import finished with ${manifest.skippedFiles} skipped files. The study may be incomplete.` : '';
}
