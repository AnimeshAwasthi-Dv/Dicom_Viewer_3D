import type { DicomTag } from '../../types/dicom';
import type { Series } from '../study/Series';
import type { Study } from '../study/Study';
import { seriesFrames, type SeriesFrame } from '../study/StudyManager';

/**
 * Where a study's images come from. Every source hands Cornerstone image ids; Cornerstone fetches, decodes, caches
 * and renders them.
 * - `local`: files opened in the browser (`dicomfile:` ids).
 * - `remote`: a study imported from S3 by the viewer service (`decxpert:` ids, signed per session).
 * - `dicomweb`: a PACS such as Orthanc, directly or behind the imaging gateway (`wadors:` ids).
 */
export interface ImageSource {
  readonly mode: 'local' | 'remote' | 'dicomweb';
  getStudyMetadata(): Promise<Study[]>;
  /**
   * Loads a series' instance list if the source fetches it on demand (DICOMweb). Resolves at once for sources that
   * index everything up front. Listeners registered with `subscribe` receive the updated studies.
   */
  ensureSeries(series: Series): Promise<Series>;
  /** Cornerstone image ids of the series' images in display order (one per frame of a multi-frame instance). */
  imageIds(series: Series): string[];
  /** The instance and frame an image id refers to. */
  locate(imageId: string): SeriesFrame | undefined;
  /** The image id of an instance (and frame), when that series is loaded. */
  imageIdFor(sopInstanceUID: string, frameNumber?: number): string | undefined;
  /** Every tag of one image, read from its file or DICOMweb metadata. */
  tags(imageId: string): Promise<DicomTag[]>;
  subscribe(listener: (studies: Study[]) => void): () => void;
  dispose(): void;
}

/** Image ids of each series, and the way back from an image id to its instance and frame. */
export class ImageIdIndex {
  private readonly bySeries = new Map<string, string[]>();
  private readonly byImageId = new Map<string, SeriesFrame>();
  private readonly byInstance = new Map<string, string>();

  constructor(private readonly toImageId: (frame: SeriesFrame, series: Series) => string) {}

  imageIds(series: Series): string[] {
    const cached = this.bySeries.get(series.id);
    if (cached && (cached.length || !series.instances.length)) return cached;
    const ids = seriesFrames(series).map((frame) => {
      const imageId = this.toImageId(frame, series);
      this.byImageId.set(imageId, frame);
      this.byInstance.set(instanceKey(frame.instance.id, frame.frameNumber), imageId);
      return imageId;
    });
    this.bySeries.set(series.id, ids);
    return ids;
  }

  locate(imageId: string): SeriesFrame | undefined {
    return this.byImageId.get(imageId);
  }

  imageIdFor(sopInstanceUID: string, frameNumber?: number): string | undefined {
    return this.byInstance.get(instanceKey(sopInstanceUID, frameNumber && frameNumber > 1 ? frameNumber : undefined))
      ?? this.byInstance.get(instanceKey(sopInstanceUID, frameNumber ?? 1));
  }

  all(): string[] {
    return [...this.byImageId.keys()];
  }
}

function instanceKey(sopInstanceUID: string, frameNumber?: number): string {
  return frameNumber ? `${sopInstanceUID}#${frameNumber}` : sopInstanceUID;
}

/** Listener bookkeeping shared by the sources. */
export class StudyListeners {
  private readonly listeners = new Set<(studies: Study[]) => void>();
  subscribe(listener: (studies: Study[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(studies: Study[]): void {
    this.listeners.forEach((listener) => listener(studies));
  }
}
