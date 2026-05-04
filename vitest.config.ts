import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

const alias = {
  '@/db': resolve(__dirname, './src/lib/db'),
  '@/lib': resolve(__dirname, './src/lib'),
  '@/components': resolve(__dirname, './src/components'),
  '@/services': resolve(__dirname, './src/lib/services'),
  '@/inngest': resolve(__dirname, './src/lib/inngest'),
  '@/voice': resolve(__dirname, './src/lib/voice'),
  '@': resolve(__dirname, './src'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.integration.test.ts',
      ],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.integration.test.ts'],
          setupFiles: ['src/test/setup.ts'],
          env: { SKIP_ENV_VALIDATION: 'true' },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          env: { SKIP_ENV_VALIDATION: 'true' },
        },
      },
    ],
  },
});
