import { z } from 'zod';
import type { DicomMetadata } from './dicom';

const finite = z.number().finite();
const uid = z.string().min(1).max(128);
export const cameraSchema = z.object({
  zoom: finite.min(0.1).max(20),
  pan: z.object({ x: finite.min(-100000).max(100000), y: finite.min(-100000).max(100000) }),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(), flipV: z.boolean(), inverted: z.boolean()
}).strict();
export const measurementSchema = z.object({
  id: uid,
  type: z.enum(['length', 'angle', 'rectangleRoi', 'ellipseRoi', 'probe', 'annotation']),
  studyInstanceUID: uid, seriesInstanceUID: uid, sopInstanceUID: uid,
  frameOfReferenceUID: uid.optional(),
  points: z.array(z.object({ x: finite, y: finite, z: finite.optional() })).min(1).max(3),
  value: finite.optional(), unit: z.string().max(40).optional(),
  label: z.string().max(1000).optional(), createdAt: z.string().max(40),
  stats: z.object({ area: finite, mean: finite, min: finite, max: finite, stdDev: finite, unit: z.string().max(40) }).optional()
}).strict();
const vector = z.tuple([finite.min(-100).max(100), finite.min(-100).max(100), finite.min(-100).max(100)]);
export const mprSettingsSchema = z.object({
  indices: z.object({ axial: z.number().int().min(0), coronal: z.number().int().min(0), sagittal: z.number().int().min(0) }),
  windowWidth: finite.positive(), windowCenter: finite,
  volumePreset: z.enum(['lung', 'soft', 'bone', 'mip']),
  renderMode: z.enum(['mpr', 'dvr', 'mip', 'minip', 'aip']),
  volumeWindowWidth: finite.positive(), volumeWindowCenter: finite,
  volumeOpacity: finite.min(0.02).max(0.8), slabThickness: finite.min(0.03).max(1),
  volumeQuality: z.enum(['fast', 'hd', 'ultra']), fourDCine: z.boolean(), autoRotate: z.boolean(),
  camera: z.object({ position: vector, target: vector }).optional()
}).strict();
export type MprSettings = z.infer<typeof mprSettingsSchema>;
export const remoteStateSchema = z.object({
  layout: z.enum(['1x1', '1x2', '2x1', '2x2']).default('1x1'),
  viewports: z.array(z.object({
    seriesId: z.string().min(1).max(256),
    instanceIndex: z.number().int().min(0),
    windowWidth: finite.positive().optional(), windowCenter: finite.optional(),
    camera: cameraSchema.optional()
  }).strict().refine(v => (v.windowWidth === undefined) === (v.windowCenter === undefined), 'Supply both windowWidth and windowCenter')).min(1).max(4),
  activeTool: z.enum(['windowLevel', 'pan', 'zoom', 'length', 'angle', 'rectangleRoi', 'ellipseRoi', 'probe', 'annotation']).default('windowLevel'),
  cinePlaying: z.boolean().default(false), cineFps: finite.min(1).max(60).default(10),
  mprOpen: z.boolean().default(false),
  mpr: mprSettingsSchema.optional(),
  dialogs: z.object({ dicomTagsOpen: z.boolean(), shortcutsOpen: z.boolean(), exportOpen: z.boolean() }).optional(),
  measurements: z.array(measurementSchema).max(1000).default([])
}).strict().refine(state => state.viewports.length === (state.layout === '1x1' ? 1 : state.layout === '2x2' ? 4 : 2), 'Viewport count must match layout');

export type RemoteState = z.infer<typeof remoteStateSchema>;
export interface StudyManifest {
  id: string;
  instances: Array<{ key: string; metadata: DicomMetadata }>;
  skippedFiles: number;
}
export interface SessionSnapshot {
  id: string;
  studyId: string;
  revision: number;
  state: RemoteState;
  expiresAt: number;
}
export type PublicManifest = Omit<StudyManifest, 'instances'> & {
  instances: Array<{ metadata: DicomMetadata }>;
};
