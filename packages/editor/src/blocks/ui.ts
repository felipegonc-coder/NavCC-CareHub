import type { NodeViews, SlashItem } from '../types';
import * as callout from './callout.ui';
import * as code from './code.ui';
import * as colors from './colors.ui';
import * as columns from './columns.ui';
import * as embed from './embed.ui';
import * as lists from './lists.ui';
import * as math from './math.ui';
import * as media from './media.ui';
import * as page from './page.ui';
import * as synced from './synced.ui';
import * as table from './table.ui';
import * as tabs from './tabs.ui';
import * as text from './text.ui';
import * as toc from './toc.ui';
import * as toggle from './toggle.ui';

/*
 * The browser side of the block groups: each group owns its blocks/<group>.ui.ts (.tsx once it
 * has JSX) next to its schema file; core owns this file.
 *
 * - `slashItems`: the group's "/" menu entries. Within a menu group they keep the order below.
 * - `nodeViews`: React views of the group's nodes, by node name.
 * - May import React, lucide-react, @tiptap/react and ../types; the server never loads these.
 * - `blockItem()` from ./item.ui makes an entry that turns the current line into a block.
 */
const groups: { slashItems: readonly SlashItem[]; nodeViews: NodeViews }[] = [
  text, // group: text
  lists, // group: lists
  toggle, // group: toggle
  page, // group: page
  callout, // group: callout
  table, // group: table
  columns, // group: columns
  tabs, // group: tabs
  code, // group: code
  media, // group: media
  embed, // group: embed
  math, // group: math
  toc, // group: toc
  synced, // group: synced
  colors, // group: colors
];

export const blockSlashItems: readonly SlashItem[] = groups.flatMap((group) => group.slashItems);

export const blockNodeViews: NodeViews = Object.assign(
  {},
  ...groups.map((group) => group.nodeViews),
);
