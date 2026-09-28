import { cache } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { DicomMetadata } from '../../types/dicom';
import { registerImageMetadata, unregisterImageMetadata } from '../cornerstone/metadata';
import { buildStudies } from '../study/StudyManager';
import type { Series } from '../study/Series';
import type { Study } from '../study/Study';
import { ImageIdIndex, StudyListeners, type ImageSource } from './ImageSource';
import { wadouriTags } from './wadouriTags';

export interface LocalDicomFile {
  file: Blob;
  metadata: DicomMetadata;
  error?: string;
}

/** Files opened in the browser. They never leave the device: Cornerstone reads them straight from the Blob. */
export class LocalFileImageSource implements ImageSource {
  readonly mode = 'local';
  private readonly studies: Study[];
  private readonly fileIndex = new Map<string, number>();
  private readonly index: ImageIdIndex;
  private readonly listeners = new StudyListeners();

  constructor(files: LocalDicomFile[]) {
    const readable = files.filter((entry) => !entry.error);
    readable.forEach((entry) => {
      // `dicomfile:<n>` ids address the Blob; Cornerstone parses it on first use.
      const imageId = wadouri.fileManager.add(entry.file);
      this.fileIndex.set(entry.metadata.sopInstanceUID, Number(imageId.slice('dicomfile:'.length)));
    });
    this.studies = buildStudies(files.map(({ metadata, error }) => ({ metadata, error })), true);
    // Instances that failed to parse stay listed as study errors but are not viewable.
    this.studies.forEach((study) => study.series.forEach((series) => {
      series.instances = series.instances.filter((instance) => this.fileIndex.has(instance.id));
    }));
    this.index = new ImageIdIndex(({ instance, frameNumber }) => {
      const imageId = `dicomfile:${this.fileIndex.get(instance.id)}${frameNumber ? `&frame=${frameNumber}` : ''}`;
      // Multi-frame geometry is per frame, which only the file itself has.
      if (!frameNumber) registerImageMetadata(imageId, instance.metadata);
      return imageId;
    });
    this.studies.forEach((study) => study.series.forEach((series) => this.index.imageIds(series)));
  }

  async getStudyMetadata(): Promise<Study[]> { return this.studies; }
  async ensureSeries(series: Series): Promise<Series> { return series; }
  imageIds(series: Series): string[] { return this.index.imageIds(series); }
  locate(imageId: string) { return this.index.locate(imageId); }
  imageIdFor(sopInstanceUID: string, frameNumber?: number) { return this.index.imageIdFor(sopInstanceUID, frameNumber); }
  tags(imageId: string) { return wadouriTags(imageId); }
  subscribe(listener: (studies: Study[]) => void) { return this.listeners.subscribe(listener); }

  dispose(): void {
    const ids = this.index.all();
    unregisterImageMetadata(ids);
    ids.forEach((imageId) => wadouri.dataSetCacheManager.unload(wadouri.parseImageId(imageId).url));
    this.fileIndex.forEach((index) => wadouri.fileManager.remove(index));
    cache.purgeCache();
  }
}
