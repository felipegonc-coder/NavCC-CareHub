/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  define: {
    // The build ID. The collab server refuses pages to a tab from another build (the page then
    // asks to reload), so it must match the server's CAREHUB_VERSION.
    __CAREHUB_VERSION__: JSON.stringify(process.env.CAREHUB_VERSION || '0.0.0-dev'),
  },
  server: {
    // The API runs separately in development (npm run build && npm start in apps/server).
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
