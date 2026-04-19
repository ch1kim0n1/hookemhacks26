import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  // amazon-cognito-identity-js uses the `buffer` package which expects a Node
  // `global`. Polyfill it in the browser so the SDK runs in Vite.
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
      },
    },
  },
});
