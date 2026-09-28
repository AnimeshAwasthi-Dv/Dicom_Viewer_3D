import { cache } from '@cornerstonejs/core';
import { wadors } from '@cornerstonejs/dicom-image-loader';
import type { Instance } from '../study/Instance';
import type { Series } from '../study/Series';
import type { Study } from '../study/Study';
import { instanceSortPosition, sortSeriesInstances } from '../study/StudyManager';
import { dicomJsonTags, dicomJsonToMetadata, jsonNumber, jsonString, type DicomJson } from './dicomJson';
import { ImageIdIndex, StudyListeners, type ImageSource } from './ImageSource';

/**
 * A study on a DICOMweb server: Orthanc behind the RadAgent imaging gateway (same origin, scoped by the session
 * cookie), or any QIDO-RS / WADO-RS endpoint. Series are listed at once; each series' instance metadata is fetched
 * when it is first shown, since a PACS can take seconds per series to assemble it.
 */
export class DicomWebImageSource implements ImageSource {
  readonly mode = 'dicomweb';
  private readonly root: string;
  private studies: Study[] = [];
  private readonly loading = new Map<string, Promise<Series>>();
  private readonly instanceJson = new Map<string, DicomJson>();
  private readonly listeners = new StudyListeners();
  private readonly abort = new AbortController();
  private readonly index: ImageIdIndex;

  constructor(root: string, private readonly studyInstanceUID: string) {
    this.root = new URL(root.replace(/\/+$/, ''), window.location.href).href;
    this.index = new ImageIdIndex(({ instance, frameNumber }, series) => {
      const imageId = `wadors:${this.studyUrl()}/series/${encodeURIComponent(series.seriesInstanceUID)}/instances/${encodeURIComponent(instance.id)}/frames/${frameNumber ?? 1}`;
      wadors.metaDataManager.add(imageId, this.instanceJson.get(instance.id) as never);
      return imageId;
    });
  }

  async getStudyMetadata(): Promise<Study[]> {
    const [seriesList, studyList] = await Promise.all([
      this.json(`${this.studyUrl()}/series`),
      // Patient and study details; the gateway allows this search only for the session's own study.
      this.json(`${this.root}/studies?StudyInstanceUID=${encodeURIComponent(this.studyInstanceUID)}`).catch(() => [] as DicomJson[])
    ]);
    const studyJson = studyList[0] ?? seriesList[0] ?? {};
    const series: Series[] = seriesList
      .map((item) => ({
        id: `${this.studyInstanceUID}:${jsonString(item, '0020000E') ?? ''}`,
        studyInstanceUID: this.studyInstanceUID,
        seriesInstanceUID: jsonString(item, '0020000E') ?? '',
        description: jsonString(item, '0008103E') ?? `Series ${jsonNumber(item, '00200011') ?? ''}`.trim(),
        modality: jsonString(item, '00080060') ?? 'OT',
        seriesNumber: jsonNumber(item, '00200011'),
        instances: [] as Instance[],
        expectedImageCount: jsonNumber(item, '00201209') ?? 0
      }))
      .filter((item) => item.seriesInstanceUID)
      .sort((a, b) => (a.seriesNumber ?? 99999) - (b.seriesNumber ?? 99999));
    if (!series.length) throw new Error('No image series were found in this study.');
    this.studies = [{
      id: this.studyInstanceUID,
      studyInstanceUID: this.studyInstanceUID,
      patientName: jsonString(studyJson, '00100010'),
      patientId: jsonString(studyJson, '00100020'),
      patientSex: jsonString(studyJson, '00100040'),
      patientBirthDate: jsonString(studyJson, '00100030'),
      patientAge: jsonString(studyJson, '00101010'),
      studyDescription: jsonString(studyJson, '00081030'),
      studyDate: jsonString(studyJson, '00080020'),
      modality: [...new Set(series.map((item) => item.modality))].join(' / '),
      series,
      errors: []
    }];
    return this.studies;
  }

  ensureSeries(series: Series): Promise<Series> {
    const current = this.findSeries(series.id) ?? series;
    if (current.instances.length) return Promise.resolve(current);
    let pending = this.loading.get(series.id);
    if (!pending) {
      pending = this.loadSeries(current);
      this.loading.set(series.id, pending);
      pending.catch(() => this.loading.delete(series.id));
    }
    return pending;
  }

  imageIds(series: Series): string[] { return this.index.imageIds(this.findSeries(series.id) ?? series); }
  locate(imageId: string) { return this.index.locate(imageId); }
  imageIdFor(sopInstanceUID: string, frameNumber?: number) { return this.index.imageIdFor(sopInstanceUID, frameNumber); }
  subscribe(listener: (studies: Study[]) => void) { return this.listeners.subscribe(listener); }

  async tags(imageId: string) {
    const instance = this.locate(imageId)?.instance;
    const json = instance ? this.instanceJson.get(instance.id) : undefined;
    return json ? dicomJsonTags(json) : [];
  }

  dispose(): void {
    this.abort.abort();
    this.index.all().forEach((imageId) => wadors.metaDataManager.remove(imageId));
    cache.purgeCache();
  }

  private async loadSeries(series: Series): Promise<Series> {
    // WADO-RS series metadata has every attribute the renderer needs; QIDO instance searches omit rescale and VOI.
    const instancesJson = await this.json(`${this.studyUrl()}/series/${encodeURIComponent(series.seriesInstanceUID)}/metadata`);
    const instances = instancesJson.map((json): Instance => {
      const metadata = dicomJsonToMetadata(json);
      this.instanceJson.set(metadata.sopInstanceUID, json);
      const instance: Instance = { id: metadata.sopInstanceUID, fileName: metadata.fileName, metadata, sortPosition: 0, errors: [] };
      instance.sortPosition = instanceSortPosition(instance);
      return instance;
    }).filter((instance) => instance.id && instance.metadata.rows > 0);
    const sorted = sortSeriesInstances(instances);
    const loaded: Series = { ...series, instances: sorted, thumbnailInstanceId: sorted[Math.floor(sorted.length / 2)]?.id };
    const study = this.studies[0];
    // Fill patient details from the images when the study search didn't return them.
    const first = sorted[0]?.metadata;
    this.studies = [{
      ...study,
      patientName: study.patientName ?? first?.patientName,
      patientId: study.patientId ?? first?.patientId,
      patientSex: study.patientSex ?? first?.patientSex,
      patientAge: study.patientAge ?? first?.patientAge,
      bodyPartExamined: study.bodyPartExamined ?? first?.bodyPartExamined,
      studyDescription: study.studyDescription ?? first?.studyDescription,
      studyDate: study.studyDate ?? first?.studyDate,
      series: study.series.map((item) => item.id === series.id ? loaded : item)
    }];
    this.listeners.emit(this.studies);
    return loaded;
  }

  private findSeries(id: string): Series | undefined {
    return this.studies[0]?.series.find((series) => series.id === id);
  }

  private studyUrl(): string {
    return `${this.root}/studies/${encodeURIComponent(this.studyInstanceUID)}`;
  }

  private async json(url: string): Promise<DicomJson[]> {
    const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/dicom+json' }, signal: this.abort.signal });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'This viewer session has expired or does not include this study.' : `The image server returned ${response.status}.`);
    return await response.json() as DicomJson[];
  }
}
