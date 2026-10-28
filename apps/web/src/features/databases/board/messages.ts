/** Everything the board says. The spec's own words where it has them ("Move to…", "Load more"). */
export const BOARD_TEXT = {
  newCard: 'New',
  loadMore: 'Load more',
  hiddenGroups: 'Hidden groups',
  show: 'Show',
  showGroup: (label: string) => `Show ${label}`,
  hiddenByFilter: 'Hidden by filter',
  cardMenu: (title: string) => `Card menu for ${title}`,
  open: 'Open',
  moveTo: 'Move to…',
  duplicate: 'Duplicate',
  copyLink: 'Copy link',
  linkCopied: 'Link copied.',
  linkNotCopied: "Couldn't copy the link.",
  delete: 'Delete',
  collapse: (label: string) => `Collapse ${label}`,
  expand: (label: string) => `Expand ${label}`,
  columnMenu: (label: string) => `Column menu for ${label}`,
  hide: 'Hide',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  calculate: 'Calculate',
  /** Phones: the buttons that bring a column into view. */
  columns: 'Columns',
  newTitle: 'Name',
  /** Read out when Space picks a card up. */
  pickedUp: (title: string) =>
    `Picked up '${title}'. Arrow keys move it, Space drops it, Esc cancels.`,
  /** Read out while a picked-up card moves. */
  movingTo: (place: string, position: number, total: number) => `${place}, ${position} of ${total}`,
  /** The spec's announcement: "Moved 'Call back Blue Pine Plumbing' to Done". */
  moved: (title: string, place: string) => `Moved '${title}' to ${place}`,
  cancelled: (title: string) => `Move cancelled. '${title}' is back where it was.`,
  /** A column inside a lane, for announcements. */
  inLane: (column: string, lane: string) => `${column}, ${lane}`,
} as const;
