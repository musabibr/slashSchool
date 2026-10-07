import { defineConfig } from 'tsup';

// Bundles the API (and the workspace-only @slash/shared source) into dist/; npm deps stay external.
export default defineConfig({
  entry: { index: 'src/index.ts', seed: 'src/seed/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@slash/shared'],
});
