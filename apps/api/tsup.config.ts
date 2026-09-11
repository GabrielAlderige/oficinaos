import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    migrate: 'scripts/migrate.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // o pacote compartilhado é TypeScript puro: entra no bundle
  noExternal: ['@oficinaos/shared'],
});
