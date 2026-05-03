import typescriptEslint from '@typescript-eslint/eslint-plugin';
import nextConfig from 'eslint-config-next';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextConfig,
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
      import: importPlugin,
    },
    rules: {
      // Unused variables / imports
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',

      // General quality
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Console: only allow warn and error
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Forbid raw SVG file imports — use @/components/ui/icon instead
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '\\.svg(\\?.*)?$',
              message: 'Import icons from @/components/ui/icon instead of raw SVG files.',
            },
          ],
        },
      ],

      // React hooks exhaustive deps
      'react-hooks/exhaustive-deps': 'warn',

      // Import ordering
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  // ─── (app)/ server code: forbid bare `db` import ──────────────────────────
  // Use dbForRequest() so every query runs under org-scoped RLS context.
  {
    files: ['src/app/(app)/**/*.{ts,tsx}', 'src/actions/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportDeclaration[source.value='@/lib/db/client'] > ImportSpecifier[imported.name='db']",
          message:
            'Use dbForRequest() from @/lib/db/client instead of the bare db in (app)/ server code. Direct db usage bypasses RLS org context.',
        },
        {
          selector:
            "ImportDeclaration[source.value='@/lib/db'] > ImportSpecifier[imported.name='db']",
          message:
            'Use dbForRequest() from @/lib/db/client instead of the bare db in (app)/ server code. Direct db usage bypasses RLS org context.',
        },
      ],
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'public/**',
      'postcss.config.mjs',
      'playwright-report/**',
      'test-results/**',
      '.playwright-browsers/**',
    ],
  },
];

export default config;
