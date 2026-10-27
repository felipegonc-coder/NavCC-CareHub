import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PanelName, PanelProps } from './contract';

export type PanelComponent =
  ComponentType<PanelProps> | LazyExoticComponent<ComponentType<PanelProps>>;

/**
 * What each toolbar panel and dialog shows, loaded the first time it opens. Each panel's builder
 * changes only its own line, to `lazy(() => import('./<folder>/<panel>'))` with a default export
 * that takes PanelProps, so parallel pull requests never edit the same lines.
 */
export const PANELS: Record<PanelName, PanelComponent> = {
  filter: lazy(() => import('./shell/panel-not-built')),

  sort: lazy(() => import('./shell/panel-not-built')),

  group: lazy(() => import('./filters/group-entry')),

  properties: lazy(() => import('./shell/panel-not-built')),

  layout: lazy(() => import('./shell/panel-not-built')),

  importCsv: lazy(() => import('./shell/panel-not-built')),

  exportCsv: lazy(() => import('./shell/panel-not-built')),

  rowAccess: lazy(() => import('./shell/panel-not-built')),

  propertyAccess: lazy(() => import('./shell/panel-not-built')),
};
