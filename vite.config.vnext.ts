import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'out/renderer-vnext' },
  root: 'src/renderer-vnext',
  publicDir: false,
});