import type { Screen } from '../screens.js';

// The Extras lane's screens (docs/extras/README.md): search, history, templates, import and export,
// the knowledge base and Claude. Names start with `extras-`.
export const screens: Screen[] = [
  // Import and export: the Print view and an export's download screen. The IDs are fictional, so
  // until a seeded page can be printed they show their not-found state.
  { name: 'extras-print', path: '/p/3f0c2a52-8a7e-4c3e-9d55-6a0f1d9b7c21/print' },
  { name: 'extras-export-download', path: '/exports/b8a1e3a4-5c0d-4f7e-8a2b-9c1d2e3f4a5b' },
];
