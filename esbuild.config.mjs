import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  legalComments: 'none',
  sourcemap: false,
};

await Promise.all([
  build({ ...shared, entryPoints: ['src/daemon.ts'],    outfile: 'dist/daemon.cjs' }),
  build({ ...shared, entryPoints: ['src/server.ts'],    outfile: 'dist/server.cjs' }),
  build({ ...shared, entryPoints: ['scripts/setup.ts'], outfile: 'dist/setup.cjs' }),
]);

console.log('✅ Build complete: dist/daemon.cjs, dist/server.cjs, dist/setup.cjs');
