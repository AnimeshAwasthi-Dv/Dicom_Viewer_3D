import { DicomParser } from '../dicom/DicomParser';

export interface DicomWorkerFile {
  name: string;
  buffer: ArrayBuffer;
}

export interface DicomWorkerRequest {
  id: string;
  files: DicomWorkerFile[];
}

export interface DicomWorkerResponse {
  id: string;
  parsed: ReturnType<DicomParser['parse']>[];
}

self.onmessage = async (event: MessageEvent<DicomWorkerRequest>) => {
  const parser = new DicomParser();
  const parsed = await Promise.all(
    event.data.files.map(async (file) => {
      try {
        return parser.parse(file.buffer, file.name);
      } catch (error) {
        return {
          metadata: {
            fileName: file.name,
            studyInstanceUID: crypto.randomUUID(),
            seriesInstanceUID: crypto.randomUUID(),
            sopInstanceUID: crypto.randomUUID(),
            rows: 0,
            columns: 0,
            bitsAllocated: 16,
            bitsStored: 16,
            pixelRepresentation: 0 as const,
            photometricInterpretation: 'MONOCHROME2',
            samplesPerPixel: 1,
            rescaleSlope: 1,
            rescaleIntercept: 0,
            transferSyntaxUID: 'unknown'
          },
          error: error instanceof Error ? error.message : 'Invalid DICOM file.'
        };
      }
    })
  );
  self.postMessage({ id: event.data.id, parsed });
};
