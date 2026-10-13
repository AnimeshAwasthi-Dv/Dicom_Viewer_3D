import type { ParsedDicomFile } from '../../types/dicom';
import type { Instance } from './Instance';
import type { Series } from './Series';
import type { Study } from './Study';

function normalFromOrientation(iop?: [number, number, number, number, number, number]): [number, number, number] | undefined {
  if (!iop) return undefined;
  const [rx, ry, rz, cx, cy, cz] = iop;
  return [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
}

export function instanceSortPosition(instance: Instance): number {
  const normal = normalFromOrientation(instance.metadata.imageOrientationPatient);
  const position = instance.metadata.imagePositionPatient;
  if (normal && position) return normal[0] * position[0] + normal[1] * position[1] + normal[2] * position[2];
  return instance.metadata.instanceNumber ?? 0;
}

export function sortSeriesInstances(instances: Instance[]): Instance[] {
  const byNumber = [...instances].sort((a, b) => (a.metadata.instanceNumber ?? 0) - (b.metadata.instanceNumber ?? 0));
  // A SeriesInstanceUID is an acquisition container, not necessarily one
  // scrollable anatomical stack. Diffusion, perfusion and multi-echo scanners
  // commonly reuse every slice position for a second contrast/time point. If
  // we sort such a series by geometry, the volumes become interleaved
  // (slice 1 volume A, slice 1 volume B, slice 2 volume A, ...). Preserve the
  // scanner's acquisition order until these groups become separate display
  // sets, as clinical viewers do.
  const positions = instances.map((instance) => instance.sortPosition);
  const hasRepeatedPositions = new Set(positions.map((value) => value.toFixed(3))).size < positions.length;
  if (hasRepeatedPositions) return byNumber;

  const sorted = [...instances].sort((a, b) => a.sortPosition - b.sortPosition || (a.metadata.instanceNumber ?? 0) - (b.metadata.instanceNumber ?? 0));
  const numbered = sorted.filter((instance) => instance.metadata.instanceNumber !== undefined);
  if (numbered.length >= 2) {
    const first = numbered[0].metadata.instanceNumber ?? 0;
    const last = numbered[numbered.length - 1].metadata.instanceNumber ?? 0;
    if (first > last) sorted.reverse();
  }
  return sorted;
}

export function buildStudies(parsed: ParsedDicomFile[], metadataOnly = false): Study[] {
  const studyMap = new Map<string, Study>();
  const seriesMap = new Map<string, Series>();

  parsed.forEach((file) => {
    const metadata = file.metadata;
    const studyId = metadata.studyInstanceUID;
    const seriesId = `${studyId}:${metadata.seriesInstanceUID}`;
    let study = studyMap.get(studyId);
    if (!study) {
      study = {
        id: studyId,
        studyInstanceUID: studyId,
        patientName: metadata.patientName,
        patientId: metadata.patientId,
        patientSex: metadata.patientSex,
        patientBirthDate: metadata.patientBirthDate,
        patientAge: metadata.patientAge,
        bodyPartExamined: metadata.bodyPartExamined,
        studyDescription: metadata.studyDescription,
        studyDate: metadata.studyDate,
        modality: metadata.modality,
        series: [],
        errors: []
      };
      studyMap.set(studyId, study);
    }

    if (file.error) study.errors.push(`${metadata.fileName}: ${file.error}`);
    if (!file.pixelData && !metadataOnly) return;

    let series = seriesMap.get(seriesId);
    if (!series) {
      series = {
        id: seriesId,
        studyInstanceUID: studyId,
        seriesInstanceUID: metadata.seriesInstanceUID,
        description: metadata.seriesDescription ?? `Series ${metadata.seriesNumber ?? study.series.length + 1}`,
        modality: metadata.modality ?? 'OT',
        seriesNumber: metadata.seriesNumber,
        instances: []
      };
      seriesMap.set(seriesId, series);
      study.series.push(series);
    }

    const instance: Instance = {
      id: metadata.sopInstanceUID,
      fileName: metadata.fileName,
      metadata,
      sortPosition: 0,
      errors: file.error ? [file.error] : []
    };
    instance.sortPosition = instanceSortPosition(instance);
    series.instances.push(instance);
  });

  for (const series of seriesMap.values()) {
    series.instances = sortSeriesInstances(series.instances);
    series.thumbnailInstanceId = series.instances[Math.floor(series.instances.length / 2)]?.id;
  }

  for (const study of studyMap.values()) {
    study.series.sort((a, b) => (a.seriesNumber ?? 99999) - (b.seriesNumber ?? 99999) || b.instances.length - a.instances.length);
    study.modality = Array.from(new Set(study.series.map((series) => series.modality))).join(' / ');
  }

  return Array.from(studyMap.values());
}

export interface SeriesFrame {
  instance: Instance;
  /** 1-based frame of a multi-frame instance; absent for single-frame instances. */
  frameNumber?: number;
}

/** The series' images in display order: one per single-frame instance, one per frame of a multi-frame instance. */
export function seriesFrames(series: Series): SeriesFrame[] {
  return series.instances.flatMap((instance) => {
    const frames = instance.metadata.numberOfFrames ?? 1;
    return frames > 1 ? Array.from({ length: frames }, (_, index) => ({ instance, frameNumber: index + 1 })) : [{ instance }];
  });
}

/** Images in the series (frames, for multi-frame instances), or the reported count while it is still loading. */
export function imageCount(series: Series): number {
  return series.instances.length ? series.instances.reduce((count, instance) => count + (instance.metadata.numberOfFrames ?? 1), 0) : series.expectedImageCount ?? 0;
}

export function choosePrimarySeries(studies: Study[]): Series | undefined {
  return studies
    .flatMap((study) => study.series)
    .filter((series) => imageCount(series) > 0)
    .sort((a, b) => {
      const modalityScore = (series: Series) => (series.modality === 'CT' || series.modality === 'MR' ? 0 : 1);
      return modalityScore(a) - modalityScore(b) || imageCount(b) - imageCount(a);
    })[0];
}
