// Bundles the server into dist/index.js, and each worker thread into its own file next to it:
// dist/calendar-parse-worker.js (the calendar reader, see parse-in-worker.ts) and
// dist/import-worker.js (reading uploads for import, see import-export/import/isolate.ts).
// Worker names are unique across lanes. Workspace packages (@carehub/*) are TypeScript source, so
// they are bundled; every other package stays external and loads from node_modules.
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
  entryPoints: {
    index: 'src/index.ts',
    'calendar-parse-worker': 'src/features/calendar/sync/ical/parse-worker.ts',
    'import-worker': 'src/features/import-export/import/worker.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalNodeModules],
});
