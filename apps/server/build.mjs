// Bundles the server into dist/index.js. Workspace packages (@carehub/*) are TypeScript
// source, so they are bundled; every other package stays external and loads from node_modules.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const externalNodeModules = {
  name: 'external-node-modules',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point' || args.path.startsWith('@carehub/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalNodeModules],
});
