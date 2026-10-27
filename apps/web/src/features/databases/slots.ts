/**
 * What Databases adds to the app (decision 0007, section 5.3): database pages, the `database`
 * block in the page editor and its "/database" entry. The screens load on first use, so the
 * app's start doesn't wait for them.
 */
import { createElement, lazy, Suspense } from 'react';
import type { FeatureSlots } from '../../slots';
import type { DatabaseBlockProps } from './shell/database-block';
import type { DatabasePageProps } from './shell/database-page';
import { databaseSlashItem } from './slash';

const LazyPage = lazy(async () => ({
  default: (await import('./shell/database-page')).DatabasePage,
}));
const LazyBlock = lazy(async () => ({
  default: (await import('./shell/database-block')).DatabaseBlock,
}));

/** A page of kind 'database'. */
export function DatabasePageSlot(props: DatabasePageProps) {
  return createElement(Suspense, { fallback: null }, createElement(LazyPage, props));
}

/** The editor's `database` block. */
export function DatabaseBlockSlot(props: DatabaseBlockProps) {
  return createElement(Suspense, { fallback: null }, createElement(LazyBlock, props));
}

export const slots: FeatureSlots = {
  pageKindViews: { database: DatabasePageSlot },
  editor: {
    nodeViews: { database: DatabaseBlockSlot },
    slashItems: [databaseSlashItem],
  },
};
