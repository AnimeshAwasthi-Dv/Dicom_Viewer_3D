import type { RemoteState, StudyManifest } from '../src/types/remote';
import { buildStudies, choosePrimarySeries, imageCount } from '../src/viewer/study/StudyManager';

export function manifestStudies(manifest: StudyManifest) {
  return buildStudies(manifest.instances.map(instance => ({ metadata: instance.metadata })), true);
}

export function initialState(manifest: StudyManifest): RemoteState {
  const primary = choosePrimarySeries(manifestStudies(manifest));
  if (!primary) throw new Error('Study has no supported images');
  return { layout: '1x1', viewports: [{ seriesId: primary.id, instanceIndex: 0 }], activeTool: 'windowLevel', cinePlaying: false, cineFps: 10, mprOpen: false, measurements: [] };
}

export function validateState(state: RemoteState, manifest: StudyManifest): boolean {
  const series = manifestStudies(manifest).flatMap(study => study.series);
  return state.viewports.every(viewport => {
    const selected = series.find(item => item.id === viewport.seriesId);
    return selected && viewport.instanceIndex < imageCount(selected);
  }) && state.measurements.every(measurement => manifest.instances.some(instance =>
    instance.metadata.sopInstanceUID === measurement.sopInstanceUID &&
    instance.metadata.seriesInstanceUID === measurement.seriesInstanceUID &&
    instance.metadata.studyInstanceUID === measurement.studyInstanceUID &&
    (measurement.frameNumber ?? 1) <= (instance.metadata.numberOfFrames ?? 1)));
}
