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
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'public/**',
      'postcss.config.mjs',
    ],
  },
];

export default config;
