declare module '@cornerstonejs/codec-openjpeg/decode' {
  export interface J2KFrameInfo {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned?: boolean;
  }

  export interface J2KDecoderInstance {
    getEncodedBuffer(length: number): Uint8Array;
    decode(): void;
    getFrameInfo(): J2KFrameInfo;
    getDecodedBuffer(): ArrayBuffer | Uint8Array | Uint16Array | Int16Array;
    delete?(): void;
  }

  export interface OpenJpegModule {
    J2KDecoder: new () => J2KDecoderInstance;
  }

  type OpenJpegFactory = () => Promise<OpenJpegModule>;
  const factory: OpenJpegFactory;
  export default factory;
}
