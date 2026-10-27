import type { RouteObject } from 'react-router';

/** Import and export's screens, each loaded lazily (Extras lane, docs/extras/README.md). */
export const routes: RouteObject[] = [
  {
    // The 🔔 notice's Download button: a background export, for the person who made it.
    path: 'exports/:exportId',
    lazy: async () => ({ Component: (await import('./export/ExportScreen')).ExportScreen }),
  },
  {
    // Page menu → Print, and Export → PDF (the browser's Save as PDF): the page alone, to print.
    path: 'p/:pageId/print',
    lazy: async () => ({ Component: (await import('./print/PrintScreen')).PrintScreen }),
  },
];
