/** What the Properties panel says (Databases spec 3.2 and 3.3). */
import { LIMITS } from '@carehub/databases';

export const PROPERTIES_TEXT = {
  search: 'Search for a property',
  shown: 'Shown in this view',
  hidden: 'Hidden in this view',
  showAll: 'Show all',
  hideAll: 'Hide all',
  noMatches: 'No matches',
  alwaysShown: 'Always shown',
  width: 'Width',
  widthHint: `${LIMITS.columnWidthMin} to ${LIMITS.columnWidthMax} px. Empty: the default.`,
  widthError: `Enter a width from ${LIMITS.columnWidthMin} to ${LIMITS.columnWidthMax}.`,
  wrap: 'Wrap column',
  deleted: 'Deleted',
  back: 'Back',
  readOnly: 'Only people who can edit this view change its properties.',
  show: (name: string) => `Show ${name}`,
  hide: (name: string) => `Hide ${name}`,
  move: (name: string) => `Move ${name}`,
  moved: (name: string, position: number, count: number) =>
    `Moved ${name} to ${position} of ${count}.`,
  column: (name: string) => `Width and wrap of ${name}`,
} as const;
