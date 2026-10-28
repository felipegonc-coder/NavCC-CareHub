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

/** The block's own grip (shell/database-block.tsx), where the editor picks the block up. */
const GRIP = '[data-database-block] > [data-drag-handle]';

/**
 * The block's `stopEvent`: true leaves an event to the block, so clicks, keys, pastes and drops
 * reach its cells, menus and search box. Only the events on its grip go to the editor, which
 * drags the block from there. The block is draggable, so a drag started anywhere else in it
 * would carry the whole block off; that drag is cancelled, as in Tiptap's own default.
 */
export function stopBlockEvent(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest(GRIP)) return false;
  // A drag of the block's own box: the editor's outer element, around the block's view.
  if (event.type === 'dragstart' && !target.closest('[data-database-block]')) {
    event.preventDefault();
  }
  return true;
}

export const slots: FeatureSlots = {
  pageKindViews: { database: DatabasePageSlot },
  editor: {
    nodeViews: { database: { component: DatabaseBlockSlot, stopEvent: stopBlockEvent } },
    slashItems: [databaseSlashItem],
  },
};
