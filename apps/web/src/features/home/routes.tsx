import type { RouteObject } from 'react-router';
import { HomeScreen } from './HomeScreen';

/**
 * Home at `/`. Spread into appRoutes by apps/web/src/routes.tsx.
 *
 * Unlike other screens, Home isn't loaded lazily: it's the first screen after signing in, so it
 * ships with the app. A lazy first route also makes the router build a fetch `Request` with an
 * AbortSignal on first load, which fails under jsdom in the route tests.
 */
export const routes: RouteObject[] = [{ index: true, Component: HomeScreen }];
