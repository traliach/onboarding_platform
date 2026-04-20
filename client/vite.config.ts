/**
 * Vite config — React + TypeScript SPA.
 *
 * API calls go directly to `VITE_API_BASE_URL` (cross-origin), not through
 * a dev proxy. The server's CORS_ALLOWED_ORIGINS already lists
 * http://localhost:5173, so this matches production (Vercel → ALB) and
 * exercises the real cookie semantics in development.
 */

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
});
