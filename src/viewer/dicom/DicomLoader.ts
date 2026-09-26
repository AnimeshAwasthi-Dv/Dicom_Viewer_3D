import type { ParsedDicomFile } from '../../types/dicom';
import type { DicomWorkerRequest, DicomWorkerResponse } from '../workers/dicomWorker';

export interface LoadProgress {
  phase: string;
  indexed: number;
  total: number;
}

export class DicomLoader {
  async loadFiles(files: File[], onProgress: (progress: LoadProgress) => void): Promise<ParsedDicomFile[]> {
    onProgress({ phase: 'Preparing files', indexed: 0, total: files.length });
    const loadFiles = await this.expandArchives(files, onProgress);
    onProgress({ phase: 'Reading study', indexed: 0, total: loadFiles.length });
    const batchSize = 48;
    const worker = new Worker(new URL('../workers/dicomWorker.ts', import.meta.url), { type: 'module' });
    const parsed: ParsedDicomFile[] = [];

    try {
      for (let start = 0; start < loadFiles.length; start += batchSize) {
        const sourceBatch = loadFiles.slice(start, start + batchSize);
        const batch = await Promise.all(sourceBatch.map(async (file) => ({
          name: file.name,
          buffer: await file.arrayBuffer()
        })));
        const request: DicomWorkerRequest = { id: crypto.randomUUID(), files: batch };
        const response = await new Promise<DicomWorkerResponse>((resolve, reject) => {
          worker.onerror = () => reject(new Error('DICOM worker failed.'));
          worker.onmessage = (event: MessageEvent<DicomWorkerResponse>) => resolve(event.data);
          worker.postMessage(request, batch.map((file) => file.buffer));
        });
        parsed.push(...response.parsed);
        onProgress({ phase: 'Reading study', indexed: parsed.length, total: loadFiles.length });
      }
      return parsed;
    } finally {
      worker.terminate();
    }
  }

  private async expandArchives(files: File[], onProgress: (progress: LoadProgress) => void): Promise<Array<{ name: string; arrayBuffer(): Promise<ArrayBuffer> }>> {
    const expanded: Array<{ name: string; arrayBuffer(): Promise<ArrayBuffer> }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = file.webkitRelativePath || file.name;
      if (!this.isZip(file)) {
        expanded.push({ name: path, arrayBuffer: () => file.arrayBuffer() });
        onProgress({ phase: 'Preparing files', indexed: index + 1, total: files.length });
        continue;
      }

      // Loaded on demand: most sessions never open a ZIP, so it stays out of the startup bundle.
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && !this.isIgnoredEntry(entry.name));
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        const entry = entries[entryIndex];
        expanded.push({
          name: `${path}/${entry.name}`,
          arrayBuffer: () => entry.async('arraybuffer')
        });
        onProgress({ phase: `Unpacking ${file.name}`, indexed: entryIndex + 1, total: entries.length });
      }
    }
    return expanded;
  }

  private isZip(file: File): boolean {
    return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
  }

  private isIgnoredEntry(name: string): boolean {
    const normalized = name.replaceAll('\\', '/');
    return normalized.startsWith('__MACOSX/') || normalized.endsWith('/') || normalized.split('/').some((part) => part.startsWith('.'));
  }
}
