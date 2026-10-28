/** What the Layout panel says (Databases spec 3.2, 3.3, 3.13 and 3.14). */
import type { CardPreview, View } from '@carehub/databases';
import { COLOR_MESSAGES } from '@carehub/databases/color';

type OpenMode = View['openPagesIn'];
type CardSize = NonNullable<View['board']>['cardSize'];
type TabsAs = NonNullable<View['tabsAs']>;
type SubItems = NonNullable<View['subItems']>;

export const LAYOUT_TEXT = {
  readOnly: 'Only people who can edit this view change its layout.',
  noSettings: 'This layout has no settings here.',
  openPagesIn: 'Open rows in',
  loadLimit: 'Load limit',
  rows: (count: number) => `${count} rows`,
  cards: (count: number) => `${count} cards per group`,
  showPageIcon: 'Show page icons',
  wrapText: 'Wrap text',
  tabsAs: 'Show views as',
  wrapCells: 'Wrap cells',
  verticalLines: 'Show vertical lines',
  cardPreview: 'Card preview',
  cardSize: 'Card size',
  fitImage: 'Fit image',
  colorColumns: 'Color columns',
  showBy: 'Show by',
  endBy: 'End date',
  sameProperty: 'Same as Show by',
  noDate: 'No date property',
  showWeekends: 'Show weekends',
  showTable: 'Show table',
  showDependencies: 'Show dependencies',
  subItems: 'Sub-items',
  filterSubItems: 'Filter sub-items too',
  deletedProperty: 'This property was deleted.',
} as const;

/** "Open rows in" (spec 2): side panel (default), centered window or full page, in menu order. */
export const OPEN_MODE_LABELS: Readonly<Record<OpenMode, string>> = {
  side_peek: 'Side panel',
  center_peek: 'Centered window',
  full_page: 'Full page',
};

/** Card previews besides a Files property (spec 3.3: none, page cover, page content). */
export const CARD_PREVIEW_LABELS: Readonly<Record<Exclude<CardPreview['kind'], 'files'>, string>> =
  { none: 'None', cover: 'Page cover', content: 'Page content' };

/** Card sizes S, M and L (spec 3.3). */
export const CARD_SIZE_LABELS: Readonly<Record<CardSize, string>> = {
  s: 'Small',
  m: 'Medium',
  l: 'Large',
};

/** Database blocks and linked views: the view tabs as tabs or a dropdown (spec 3.2). */
export const TABS_AS_LABELS: Readonly<Record<TabsAs, string>> = {
  tabs: 'Tabs',
  dropdown: 'Dropdown',
};

/** How sub-items show (spec 3.13). */
export const SUB_ITEMS_LABELS: Readonly<Record<SubItems, string>> = {
  nested: 'Nested',
  flattened: 'Flattened',
  parents_only: 'Parents only',
};

/** Conditional color (spec 3.14); the package's messages word for word. */
export const COLOR_TEXT = {
  title: 'Conditional color',
  intro:
    'Color rows, or one property’s cells, when a condition matches. The first rule that matches wins.',
  none: 'No color rules yet.',
  add: 'Add color rule',
  count: (count: number) => (count === 1 ? '1 rule' : `${count} rules`),
  back: 'Back',
  target: 'Apply to',
  row: 'Whole row',
  color: 'Color',
  noCondition: 'No condition yet',
  conditions: (count: number) => `${count} conditions`,
  edit: (position: number) => `Edit rule ${position}`,
  move: (position: number) => `Move rule ${position}`,
  moved: (from: number, to: number, count: number) => `Moved rule ${from} to ${to} of ${count}.`,
  duplicate: (position: number) => `Duplicate rule ${position}`,
  remove: (position: number) => `Delete rule ${position}`,
  ...COLOR_MESSAGES,
} as const;
