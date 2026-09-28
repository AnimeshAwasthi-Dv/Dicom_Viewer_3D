import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

// A local DICOMweb server (for example Orthanc on :8042) to try `?study=<uid>` links in development.
const dicomWebTarget = process.env.DICOMWEB_PROXY;

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the same build is served at the root by the viewer service and under /rad-viewer/ by the
  // RadAgent imaging gateway.
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      ...(dicomWebTarget ? { '/dicom-web': { target: dicomWebTarget, changeOrigin: true } } : {})
    }
  },
  // Cornerstone's decode workers are ES modules that load their WebAssembly codecs on demand.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // The imaging libraries change far less often than the app: a separate chunk stays cached across deploys.
    rollupOptions: { output: { manualChunks: (id) => (/node_modules\/(@cornerstonejs|@kitware|gl-matrix|dicom-parser)\//.test(id) ? 'imaging' : undefined) } },
    chunkSizeWarningLimit: 2500
  },
  optimizeDeps: {
    // Pre-bundling would break the loader's `new URL('./decodeImageFrameWorker.js', import.meta.url)` worker.
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser']
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
