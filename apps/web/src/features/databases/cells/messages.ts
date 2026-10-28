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

/** Option colors by name, in the spec's order. */
export const OPTION_COLOR_LABELS = {
  default: 'Default',
  gray: 'Gray',
  brown: 'Brown',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
} as const;

/** Words in Edit property: the settings every type has and each type's own. */
export const SETTINGS_TEXT = {
  title: 'Edit property',
  description: 'Description',
  type: 'Type',
  rowPage: 'On row pages',
  rowPageChoices: {
    always: 'Always show',
    hide_when_empty: 'Hide when empty',
    always_hide: 'Always hide',
  },
  numberFormat: 'Number format',
  formats: { number: 'Number', number_commas: 'Number with commas', percent: 'Percent' },
  decimals: 'Decimals',
  automatic: 'Automatic',
  showAs: 'Show as',
  showAsChoices: { number: 'Number', bar: 'Bar', ring: 'Ring' },
  divideBy: 'Divide by',
  divideByPositive: 'Enter a number above 0.',
  color: 'Color',
  showNumber: 'Show number',
  dateFormat: 'Date format',
  relative: 'Relative (Today, Tomorrow, Yesterday)',
  timeFormat: 'Time format',
  timeViewer: "Each person's 12- or 24-hour setting",
  time12: (example: string) => `12-hour (${example})`,
  time24: (example: string) => `24-hour (${example})`,
  timeHidden: "Don't show times",
  onePerson: 'One person only',
  notify: 'Notify people when added',
  relatedTo: 'Related to',
  unknownDatabase: "A database you can't open",
  oneRow: 'One row only',
  twoWay: 'Also show on the target',
  twoWayHint: 'Adds a matching property there, which can be renamed.',
  stopTwoWayTitle: 'Stop showing on the target?',
  stopTwoWay: (name: string, database: string) => `This deletes "${name}" in ${database}.`,
  stopTwoWayUnnamed: 'This deletes the matching property in the other database.',
  stopShowing: 'Stop showing',
  prefix: 'Prefix',
  prefixExample: (example: string) => `Rows are numbered ${example}.`,
  prefixInvalid: 'Use up to 20 letters, numbers, hyphens or underscores.',
} as const;
