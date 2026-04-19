import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
  },
});
