/**
 * Words the cells show that don't come from @carehub/databases (value and option messages come
 * from VALUE_MESSAGES and OPTION_MESSAGES, cell text from formatValue).
 */
export const CELL_TEXT = {
  checked: 'Checked',
  unchecked: 'Unchecked',
  untitled: 'Untitled',
  reminder: 'Reminder',
  formulaError: '⚠ Formula error',
  pressBlocked: 'Only people who can edit this page',
  addAction: 'Add an action',
  running: 'Running',
  done: 'Done',
  search: 'Search',
  create: 'Create',
  noMatches: 'No matches',
  newRow: '+ New row',
  newRowFailed: "Couldn't add the row.",
  loading: 'Loading',
  remove: (name: string) => `Remove ${name}`,
  date: 'Date',
  start: 'Start',
  end: 'End',
  startTime: 'Start time',
  endTime: 'End time',
  endDate: 'End date',
  includeTime: 'Include time',
  timeZone: 'Time zone',
  viewerTimeZone: "Viewer's time zone",
  remind: 'Remind',
  none: 'None',
  clear: 'Clear',
  upload: 'Upload',
  uploading: 'Uploading',
  uploadFailed: "Couldn't upload",
  retry: 'Retry',
  webLink: 'Web link',
  addLink: 'Add link',
  addItem: 'Add an item',
  item: 'Item',
} as const;

/** Reminder choices, as in the spec: with a time, minutes before the start. */
export const TIME_REMINDER_LABELS: Readonly<Record<number, string>> = {
  0: 'At the time',
  5: '5 minutes before',
  10: '10 minutes before',
  15: '15 minutes before',
  30: '30 minutes before',
  60: '1 hour before',
  120: '2 hours before',
  1440: '1 day before',
  2880: '2 days before',
};

/** Without a time: days before, at 9:00 AM in each person's time zone. */
export const DAY_REMINDER_LABELS: Readonly<Record<number, string>> = {
  0: 'On the day at 9:00 AM',
  1: '1 day before at 9:00 AM',
  2: '2 days before at 9:00 AM',
  7: '7 days before at 9:00 AM',
};

/** Status groups, in their fixed order. */
export const STATUS_GROUP_LABELS = {
  todo: 'To-do',
  in_progress: 'In progress',
  complete: 'Complete',
} as const;

const rows = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`;

/** Words in the property menu, its confirms and the list of deleted properties. */
export const PROPERTY_TEXT = {
  propertyName: 'Property name',
  changeType: 'Change type',
  editProperty: 'Edit property',
  type: 'Type',
  back: 'Back',
  hide: 'Hide in this view',
  insertLeft: 'Insert left',
  insertRight: 'Insert right',
  duplicate: 'Duplicate',
  propertyAccess: 'Property access',
  delete: 'Delete',
  cancel: 'Cancel',
  nameEmpty: 'Enter a name.',
  nameTooLong: 'Property names can be up to 100 characters.',
  nameTaken: (name: string) => `A property named "${name}" already exists.`,
  changeTitle: (name: string, type: string) => `Change "${name}" to ${type}?`,
  valuesCleared: (count: number) => `Values in ${rows(count)} will be cleared.`,
  deleteTitle: (name: string) => `Delete "${name}"?`,
  valuesRemoved: (count: number) => `Values in ${rows(count)} will be removed.`,
  restoreLater:
    'Deleted properties can be restored with their values for 30 days from Properties → Deleted.',
  twoWay: (name: string, database: string) => `This also deletes "${name}" in ${database}.`,
  twoWayUnnamed: 'This also deletes the matching property in the other database.',
  deletedList: 'Deleted properties',
  noDeleted: 'No deleted properties.',
  deletedOn: (date: string) => `Deleted ${date}`,
  restore: 'Restore',
  restoreNamed: (name: string) => `Restore ${name}`,
} as const;
