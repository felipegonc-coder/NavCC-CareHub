import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewLayout } from '@carehub/databases';
import type { LayoutProps } from './contract';

export type LayoutComponent =
  ComponentType<LayoutProps> | LazyExoticComponent<ComponentType<LayoutProps>>;

/**
 * The component that draws each layout, loaded the first time it shows. Each layout's builder
 * changes only its own line, to `lazy(() => import('./<folder>/layout'))` with a default export
 * that takes LayoutProps, so parallel pull requests never edit the same lines.
 */
export const LAYOUTS: Record<ViewLayout, LayoutComponent> = {
  table: lazy(() => import('./table/layout')),

  board: lazy(() => import('./shell/not-built')),

  list: lazy(() => import('./shell/not-built')),

  gallery: lazy(() => import('./shell/not-built')),

  calendar: lazy(() => import('./shell/not-built')),

  timeline: lazy(() => import('./shell/not-built')),

  chart: lazy(() => import('./shell/not-built')),

  form: lazy(() => import('../forms/layout')),

  feed: lazy(() => import('./shell/not-built')),

  dashboard: lazy(() => import('./shell/not-built')),
};
