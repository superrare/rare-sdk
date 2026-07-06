import { defineConfig } from 'tsdown';

export default defineConfig({
  // Transpile every module separately (dist mirrors src) instead of bundling:
  // consumers import ~30 deep modules via the subpath-pattern exports, and
  // per-entry bundles would duplicate shared code and break class identity
  // (e.g. RareApiError instanceof across entries).
  entry: ['src/**/*.ts', '!src/**/*.d.ts'],
  unbundle: true,
  // Dual output so both `import` and `require` consumers work: .js/.d.ts for
  // ESM and .cjs/.d.cts for CommonJS, selected via the exports map.
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: true,
  clean: true,
});
