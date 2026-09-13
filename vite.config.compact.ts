import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, 'out/renderer-compact'), emptyOutDir: true },
  root: 'src/renderer-compact',
  publicDir: false,
});
