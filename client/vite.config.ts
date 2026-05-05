/**
 * Vite config — React + TypeScript SPA.
 *
 * API calls go to `VITE_API_BASE_URL`. Local development uses
 * http://localhost:4000; the free Vercel deployment uses `/api`, which is
 * rewritten to the ALB by client/vercel.json.
 */

/// <reference types="vitest" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
