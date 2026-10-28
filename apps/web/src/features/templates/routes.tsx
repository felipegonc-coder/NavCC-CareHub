import type { RouteObject } from 'react-router';

/** Templates's screens, each loaded lazily (Extras lane, docs/extras/README.md). */
export const routes: RouteObject[] = [
  // The template gallery, from the sidebar, a new empty page or New page ▾ → From template.
  {
    path: 'templates',
    lazy: async () => ({ Component: (await import('./gallery')).GalleryScreen }),
  },
];
