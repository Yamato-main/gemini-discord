import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'bootstrap.cjs',
        'coverage/**',
        'dist/**',
        'esbuild.config.mjs',
        'node_modules/**',
        'scripts/**',
        'src/daemon.ts',
        'src/daemon/preflight.ts',
        'src/server.ts',
        'src/shared/config.ts',
        'src/shared/types.ts',
        'src/tools/**',
        'test*.{js,cjs,ts}',
        'list-channels.ts',
        'scratch.js',
        'vitest.config.ts',
      ],
    },
  },
});
