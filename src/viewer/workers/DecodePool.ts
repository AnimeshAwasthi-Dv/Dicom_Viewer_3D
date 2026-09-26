import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import { deviceProfile } from '../core/DeviceProfile';
import type { DicomDecodeRequest, DicomDecodeResponse, DicomWarmRequest } from './dicomWorker';

type Pending = { resolve: (frame: DecodedFrame) => void; reject: (reason: Error) => void; worker: Slot };
type Slot = { worker: Worker; busy: number };

/**
 * Decodes images on a small pool of workers so JPEG-LS / JPEG 2000 decoding and rescaling never block
 * scrolling or touch input. Workers start on first use; the pixel buffers are transferred, not copied.
 */
export class DecodePool {
  private slots: Slot[] = [];
  private readonly pending = new Map<string, Pending>();
  private disposed = false;

  constructor(private readonly size = deviceProfile().decodeWorkers) {}

  /** Parse and decode a complete DICOM file (the buffer is transferred to the worker). */
  decodeFile(buffer: ArrayBuffer, expectedSopInstanceUID?: string): Promise<DecodedFrame> {
    return this.post({ id: crypto.randomUUID(), kind: 'decode', buffer, expectedSopInstanceUID }, [buffer]);
  }

  /** Decode already-extracted pixel data (the buffer is transferred to the worker). */
  decodePixels(metadata: DicomMetadata, pixelData: ArrayBuffer): Promise<DecodedFrame> {
    // The tag list isn't needed to decode, so it isn't copied to the worker.
    const slim = { ...metadata, rawTags: undefined };
    return this.post({ id: crypto.randomUUID(), kind: 'decode', metadata: slim, pixelData }, [pixelData]).then(frame => ({ ...frame, metadata }));
  }

  /**
   * Start workers and load the codecs these transfer syntaxes need, so the first decode doesn't also pay for
   * starting a worker and compiling a WebAssembly codec. Two workers are enough to cover the first slice and the
   * first neighbours; the rest start on demand.
   */
  warm(transferSyntaxes: Iterable<string>): void {
    const syntaxes = [...transferSyntaxes];
    // In a task of its own: starting workers is native work that would otherwise lengthen the caller's task.
    setTimeout(() => {
      if (this.disposed) return;
      while (this.slots.length < Math.min(2, this.size)) this.slots.push(this.spawn());
      this.slots.forEach(slot => slot.worker.postMessage({ id: 'warm', kind: 'warm', transferSyntaxes: syntaxes } satisfies DicomWarmRequest));
    }, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.slots.forEach(slot => slot.worker.terminate());
    this.slots = [];
    this.pending.forEach(pending => pending.reject(new Error('Study closed.')));
    this.pending.clear();
  }

  private post(request: DicomDecodeRequest, transfer: ArrayBuffer[]): Promise<DecodedFrame> {
    if (this.disposed) return Promise.reject(new Error('Study closed.'));
    const slot = this.pick();
    slot.busy++;
    return new Promise<DecodedFrame>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject, worker: slot });
      slot.worker.postMessage(request, transfer);
    });
  }

  private pick(): Slot {
    if (this.slots.length < this.size && this.slots.every(slot => slot.busy > 0)) this.slots.push(this.spawn());
    return this.slots.reduce((best, slot) => (slot.busy < best.busy ? slot : best));
  }

  private spawn(): Slot {
    const slot: Slot = { worker: new Worker(new URL('./dicomWorker.ts', import.meta.url), { type: 'module' }), busy: 0 };
    slot.worker.onmessage = (event: MessageEvent<DicomDecodeResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      pending.worker.busy--;
      if (event.data.frame) pending.resolve(event.data.frame);
      else pending.reject(new Error(event.data.error ?? 'Unable to decode image.'));
    };
    slot.worker.onerror = () => {
      // A crashed worker fails only its own requests; it is replaced on the next decode.
      this.slots = this.slots.filter(item => item !== slot);
      this.pending.forEach((pending, id) => {
        if (pending.worker !== slot) return;
        this.pending.delete(id);
        pending.reject(new Error('Image decoder failed.'));
      });
      slot.worker.terminate();
    };
    return slot;
  }
}
