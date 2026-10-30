// Vite: the app (src/main.tsx), project packages as runtime data (scripts/dev/projectsPlugin.ts), the save server of the
// project document (/__api/document — dev and preview, also used by the phone over USB), furniture import, the PWA.
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { configApiMiddleware } from './src/document/server';
import { importApiMiddleware } from './src/home/server';
import { pwaPlugin } from './src/pwa/build';
import { projectsPlugin } from './scripts/dev/projectsPlugin';

function documentApi(): Plugin {
  const root = process.cwd();
  return {
    name: 'home-simulator-document-api',
    configureServer(server) { server.middlewares.use(configApiMiddleware(root)); server.middlewares.use(importApiMiddleware(root)); },
    configurePreviewServer(server) { server.middlewares.use(configApiMiddleware(root)); server.middlewares.use(importApiMiddleware(root)); },
  };
}

export default defineConfig({
  plugins: [projectsPlugin(), react(), documentApi(), pwaPlugin()],
  publicDir: 'public',
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/userdata/**', '**/reports/**', '**/projects/*/preview/**'] } },
  preview: { port: 4173, strictPort: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  // the solid kernel (manifold-3d) runs in a module worker and finds its WASM through an explicit URL (three/coreWorker.ts)
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  test: {
    projects: [
      // app tests: the demo project is active before engine modules are imported (src/test/setup.ts)
      { extends: true, test: { name: 'app', setupFiles: ['src/test/setup.ts'], include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] } },
      // core tests: pure functions, no active project, no app setup (ADR 0023)
      { test: { name: 'core', include: ['packages/core/tests/**/*.test.ts'] } },
    ],
  },
});
