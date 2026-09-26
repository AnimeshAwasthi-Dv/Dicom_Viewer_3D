import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  // Decode workers load the JPEG-LS / JPEG 2000 codecs on demand, which needs ES-module workers.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
