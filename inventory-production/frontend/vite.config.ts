import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __INVENTORY_WEB_VERSION__: JSON.stringify('1.3.2'),
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3021,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3020',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
