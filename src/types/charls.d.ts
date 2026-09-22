declare module '@cornerstonejs/codec-charls/decode' {
  const factory: () => Promise<{
    JpegLSDecoder: new () => {
      getEncodedBuffer(length: number): Uint8Array;
      decode(): void;
      getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number };
      getDecodedBuffer(): Uint8Array | Uint16Array | Int16Array;
      delete(): void;
    };
  }>;
  export default factory;
}
