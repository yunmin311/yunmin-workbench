import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'out/island',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: path.resolve(__dirname, 'src/island/island.tsx'),
      },
      output: {
        entryFileNames: 'island.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});