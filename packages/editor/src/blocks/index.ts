import type { AnyExtension } from '@tiptap/core';
import { nodes as callout } from './callout';
import { nodes as code } from './code';
import { nodes as colors } from './colors';
import { nodes as columns } from './columns';
import { nodes as embed } from './embed';
import { nodes as lists } from './lists';
import { nodes as math } from './math';
import { nodes as media } from './media';
import { nodes as page } from './page';
import { nodes as synced } from './synced';
import { nodes as table } from './table';
import { nodes as tabs } from './tabs';
import { nodes as text } from './text';
import { nodes as toc } from './toc';
import { nodes as toggle } from './toggle';

/*
 * The core block catalog, one file per block group. Each group owns only its blocks/<group>.ts
 * (and, with the "/" menu, blocks/<group>.ui.tsx); core owns this file and ../schema.ts.
 *
 * - Schema only: nodes, marks, attributes, typing rules and shortcuts from @tiptap packages, never
 *   React or app code, because the collab server loads these files too (a test checks this).
 * - Never rename or remove a node, mark or attribute once it is on main: they are stored data.
 */
export const blockNodesByGroup = {
  text, // group: text
  lists, // group: lists
  toggle, // group: toggle
  callout, // group: callout
  colors, // group: colors
  code, // group: code
  table, // group: table
  columns, // group: columns
  tabs, // group: tabs
  math, // group: math
  toc, // group: toc
  synced, // group: synced
  page, // group: page
  media, // group: media
  embed, // group: embed
} satisfies Record<string, AnyExtension[]>;

export const blockNodes: AnyExtension[] = Object.values(blockNodesByGroup).flat();
