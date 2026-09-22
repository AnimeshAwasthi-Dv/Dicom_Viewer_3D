import type { DicomMetadata } from '../../types/dicom';

export class MetadataCache {
  private readonly values = new Map<string, DicomMetadata>();

  get(id: string): DicomMetadata | undefined {
    return this.values.get(id);
  }

  set(id: string, metadata: DicomMetadata): void {
    this.values.set(id, metadata);
  }
}

