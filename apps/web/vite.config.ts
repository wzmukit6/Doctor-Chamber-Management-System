/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Consume the shared package from source so types and schemas stay in sync.
      '@chamber/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin API in development so session cookies stay first-party.
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-cached vendor chunks, matched by path so sub-entry points
        // (react-dom/client, scheduler, …) land with their package.
        manualChunks(id: string) {
          const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id)?.[1];
          if (!pkg) return id.includes('packages/shared') ? 'shared' : undefined;
          if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom'].includes(pkg)) return 'react';
          if (['@tanstack/react-query', '@tanstack/query-core', 'zod', 'react-hook-form', '@hookform/resolvers'].includes(pkg)) return 'data';
          if (['i18next', 'react-i18next'].includes(pkg)) return 'i18n';
          if (pkg === 'lucide-react') return 'icons';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
