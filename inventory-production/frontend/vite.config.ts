import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const packageDefinition = JSON.parse(
  readFileSync(resolve(projectDirectory, 'package.json'), 'utf8'),
) as { version: string };
const releaseVersion = packageDefinition.version;

export default defineConfig({
  define: {
    __INVENTORY_WEB_VERSION__: JSON.stringify(releaseVersion),
  },
  plugins: [
    react(),
    {
      name: 'inventory-version-contract',
      closeBundle() {
        writeFileSync(
          resolve(projectDirectory, 'dist', 'version.json'),
          `${JSON.stringify({ packageVersion: releaseVersion, webVersion: releaseVersion }, null, 2)}\n`,
          'utf8',
        );
      },
    },
  ],
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
