/** Every text the table shows (word for word from the Databases spec where it gives one). */
export const TABLE_TEXT = {
  newRow: 'New',
  loadMore: 'Load more',
  hiddenByFilter: 'Hidden by filter',
  open: 'Open',
  /** The column menu. */
  width: 'Width',
  wrapColumn: 'Wrap column',
  freeze: 'Freeze up to here',
  hide: 'Hide in this view',
  /** The menu at the end of the header: show and hide columns. */
  properties: 'Properties',
  wrapCells: 'Wrap cells',
  /** The footer, on a column without a calculation. */
  calculate: 'Calculate',
  /** Ticking rows, and what can be done to the ticked ones. */
  selectAll: 'Select all rows',
  selectRow: (title: string) => `Select ${title}`,
  selectedRows: 'Selected rows',
  selected: (count: number) => `${count} selected`,
  setProperty: 'Set property',
  duplicate: 'Duplicate',
  delete: 'Delete',
  clearSelection: 'Clear selection',
  /** The handle at the start of a row, and the row menu. */
  rowMenu: (title: string) => `Row menu for ${title}`,
  copyLink: 'Copy link',
  linkCopied: 'Link copied.',
  linkNotCopied: "Couldn't copy the link.",
  moveUp: 'Move up',
  moveDown: 'Move down',
  /** The arrow before a Name with sub-items. */
  subItemsOf: (title: string) => `Sub-items of ${title}`,
  /** After a paste, when some values couldn't go in. */
  skipped: (count: number) =>
    count === 1
      ? "1 value didn't fit and was skipped."
      : `${count} values didn't fit and were skipped.`,
} as const;
