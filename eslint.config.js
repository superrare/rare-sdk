import js from '@eslint/js';
import functional from 'eslint-plugin-functional';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/data-access/schema.d.ts'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      functional,
    },
    // Mirrors the functional-core rules this code was written under in
    // rare-cli (same options), so its eslint-disable directives stay valid.
    rules: {
      'functional/immutable-data': [
        'error',
        {
          ignoreClasses: 'fieldsOnly',
          ignoreImmediateMutation: true,
          ignoreNonConstDeclarations: false,
        },
      ],
      'functional/no-let': ['error', { allowInForLoopInit: true }],
    },
  },
);
