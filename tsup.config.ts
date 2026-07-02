import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      client: 'src/sdk/index.ts',
      contracts: 'src/sdk/contracts.ts',
      utils: 'src/sdk/public-utils.ts',
    },
    format: ['esm'],
    target: 'node22',
    clean: true,
    dts: true,
    sourcemap: false,
    splitting: false,
  },
]);
