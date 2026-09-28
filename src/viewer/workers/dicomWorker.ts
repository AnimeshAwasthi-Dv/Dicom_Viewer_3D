import { DicomParser } from '../dicom/DicomParser';
import type { ParsedDicomFile } from '../../types/dicom';

export interface DicomWorkerFile {
  name: string;
  buffer: ArrayBuffer;
}

/** Read the headers of a batch of local files. Pixel data is decoded later, by Cornerstone, from the file itself. */
export interface DicomWorkerRequest {
  id: string;
  files: DicomWorkerFile[];
}

export interface DicomWorkerResponse {
  id: string;
  parsed: ParsedDicomFile[];
}

const parser = new DicomParser();

function failedParse(name: string, error: unknown): ParsedDicomFile {
  return {
    metadata: {
      fileName: name,
      studyInstanceUID: crypto.randomUUID(),
      seriesInstanceUID: crypto.randomUUID(),
      sopInstanceUID: crypto.randomUUID(),
      rows: 0,
      columns: 0,
      bitsAllocated: 16,
      bitsStored: 16,
      pixelRepresentation: 0,
      photometricInterpretation: 'MONOCHROME2',
      samplesPerPixel: 1,
      rescaleSlope: 1,
      rescaleIntercept: 0,
      transferSyntaxUID: 'unknown'
    },
    error: error instanceof Error ? error.message : 'Invalid DICOM file.'
  };
}

self.onmessage = (event: MessageEvent<DicomWorkerRequest>) => {
  const { id, files } = event.data;
  const parsed = files.map((file) => {
    try {
      const result = parser.parse(file.buffer, file.name, { pixelData: false });
      // Detailed tags are read from the file when the tags dialog opens; the study index only needs the summary.
      delete result.metadata.rawTags;
      return result;
    } catch (error) {
      return failedParse(file.name, error);
    }
  });
  self.postMessage({ id, parsed } satisfies DicomWorkerResponse);
};
