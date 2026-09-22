import { afterEach, describe, expect, it } from 'vitest';
import { applyRemoteState, captureRemoteState } from '../remote/state';
import { remoteStateSchema } from '../../types/remote';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { useMeasurementStore } from '../../store/measurementStore';
import { useUiStore } from '../../store/uiStore';
import { buildStudies } from '../study/StudyManager';
import { FrameLoadScheduler } from '../cache/FrameLoadScheduler';
import type { ImageSource } from '../dicom/ImageSource';
import type { DecodedFrame, DicomMetadata } from '../../types/dicom';

const metadata: DicomMetadata = {
  fileName: 'a.dcm', studyInstanceUID: 'study', seriesInstanceUID: 'series', sopInstanceUID: 'instance',
  rows: 1, columns: 1, bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 0,
  photometricInterpretation: 'MONOCHROME2', samplesPerPixel: 1,
  rescaleSlope: 1, rescaleIntercept: 0, transferSyntaxUID: '1.2.840.10008.1.2.1'
};
afterEach(() => {
  useStudyStore.getState().reset();
  useViewerStore.getState().setLayout('1x1');
  useMeasurementStore.getState().clear();
  useUiStore.setState({ mprOpen: false });
});
describe('remote viewing state', () => {
  it('applies independent viewport series, window, camera and measurements', () => {
    const studies = buildStudies([{ metadata }, { metadata: { ...metadata, seriesInstanceUID: 'other', sopInstanceUID: 'second' } }], true);
    useStudyStore.setState({ studies });
    const state = remoteStateSchema.parse({
      layout: '1x2', viewports: [
        { seriesId: 'study:series', instanceIndex: 0, windowWidth: 1500, windowCenter: -600, camera: { zoom: 2, pan: { x: 10, y: -20 }, rotation: 90, flipH: true, flipV: false, inverted: true } },
        { seriesId: 'study:other', instanceIndex: 0 }
      ], activeTool: 'annotation', cinePlaying: true, cineFps: 15,
      measurements: [{ id: 'note', type: 'annotation', studyInstanceUID: 'study', seriesInstanceUID: 'series', sopInstanceUID: 'instance', points: [{ x: 0, y: 0 }], label: 'Test', createdAt: '2026-09-23' }]
    });
    applyRemoteState(state);
    const captured = captureRemoteState();
    expect(captured.viewports.map(viewport => viewport.seriesId)).toEqual(['study:series', 'study:other']);
    expect(captured.viewports[0].windowCenter).toBe(-600);
    expect(captured.viewports[0].camera?.rotation).toBe(90);
    expect(captured.measurements[0].label).toBe('Test');
    expect(useStudyStore.getState().selectedStudyId).toBe('study');
    expect(captured.activeTool).toBe('annotation');
  });
  it('does not display a stale frame after navigation cancels a pending load', async () => {
    const series = buildStudies([{ metadata }], true)[0].series[0];
    let resolve!: (frame: DecodedFrame) => void;
    const source: ImageSource = {
      getStudyMetadata: async () => [], metrics: () => ({ framesCached: 0, memoryBytes: 0 }),
      getFrame: () => new Promise<DecodedFrame>(done => { resolve = done; })
    };
    const received: DecodedFrame[] = [];
    const scheduler = new FrameLoadScheduler();
    const loading = scheduler.loadPriority(source, series, 0, (_index, frame) => received.push(frame), () => undefined);
    scheduler.cancel();
    resolve({ metadata, storedPixels: new Uint16Array(1), modalityPixels: new Float32Array(1), min: 0, max: 0, decodeTimeMs: 0 });
    await loading;
    expect(received).toHaveLength(0);
  });
});
