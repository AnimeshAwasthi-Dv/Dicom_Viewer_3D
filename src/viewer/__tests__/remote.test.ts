import { afterEach, describe, expect, it } from 'vitest';
import { applyRemoteState, captureRemoteState } from '../remote/state';
import { remoteStateSchema } from '../../types/remote';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { useMeasurementStore } from '../../store/measurementStore';
import { useUiStore } from '../../store/uiStore';
import { buildStudies } from '../study/StudyManager';
import type { DicomMetadata } from '../../types/dicom';

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
  it('accepts the new measurement tools and multi-frame references, and older single-point notes', () => {
    const base = { studyInstanceUID: 'study', seriesInstanceUID: 'series', sopInstanceUID: 'instance', createdAt: '2026-09-28' };
    const parsed = remoteStateSchema.parse({
      layout: '1x1', viewports: [{ seriesId: 'study:series', instanceIndex: 0 }], activeTool: 'bidirectional',
      measurements: [
        { ...base, id: 'b', type: 'bidirectional', frameNumber: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 }, { x: 5, y: 3 }], value: 10, secondaryValue: 6 },
        { ...base, id: 'f', type: 'freehandRoi', points: Array.from({ length: 600 }, (_, index) => ({ x: Math.cos(index / 100), y: Math.sin(index / 100) })) },
        { ...base, id: 'n', type: 'annotation', points: [{ x: 1, y: 1 }], label: 'old controller' }
      ]
    });
    expect(parsed.measurements.map((measurement) => measurement.type)).toEqual(['bidirectional', 'freehandRoi', 'annotation']);
    expect(() => remoteStateSchema.parse({ ...parsed, activeTool: 'paintbrush' })).toThrow();
  });
});
