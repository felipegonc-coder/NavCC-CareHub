import { describe, expect, it } from 'vitest';
import type { Property } from '@carehub/databases';
import { REQUEST_LIMITS } from '@carehub/databases/schemas';
import { jobsProperties, PRIORITY, PROPS, queryData, STATUS, testViewer, USERS } from '../fixtures';
import { pastedValues, personFinder, type PastedValue } from './clipboard';
import { PASTE_ROWS, readPaste, withSavedIds, type PasteTarget } from './paste';

const byId = new Map(jobsProperties().map((p) => [p.id, p]));
const columns = [PROPS.name, PROPS.status, PROPS.priority, PROPS.technician].flatMap(
  (id) => byId.get(id) ?? [],
);

/** The fixture's four rows (sink, heater, boiler, drain) under Name, Status, Priority, Technician. */
const target = (overrides: Partial<PasteTarget> = {}): PasteTarget => ({
  lines: queryData().rows.map((row) => ({ row })),
  properties: columns,
  top: 0,
  canEdit: () => true,
  canAdd: true,
  canAddOptions: true,
  ctx: {
    viewer: testViewer(),
    findUser: personFinder([{ id: USERS.avery.id, name: 'Avery Lin' }]),
    findRows: () => [],
  },
  ...overrides,
});

const written = (writes: { row: { id: string }; property: Property; value: unknown }[]) =>
  writes.map((w) => [w.row.id, w.property.id, w.value]);

describe('readPaste', () => {
  it('fills rows as CSV import reads values, and adds rows past the last line', () => {
    const values = pastedValues(
      [
        ['Clear drain', 'Done', '', 'avery lin'],
        ['Fit new tap', 'Not started'],
      ],
      3,
      0,
    );
    const pasted = readPaste(values, target({ top: 3 }));
    expect(written(pasted.writes)).toEqual([
      ['row-drain', PROPS.name, 'Clear drain'],
      ['row-drain', PROPS.status, STATUS.done],
      ['row-drain', PROPS.priority, null],
      ['row-drain', PROPS.technician, [USERS.avery.id]],
    ]);
    expect(pasted.newRows).toEqual([
      { title: 'Fit new tap', values: { [PROPS.status]: STATUS.notStarted } },
    ]);
    expect(pasted.newOptions.size).toBe(0);
    expect(pasted.skipped).toBe(0);
  });

  it('makes one option for a name pasted twice, ignoring case; Status names are skipped', () => {
    const values = pastedValues(
      [
        ['Finished', 'Urgent'],
        ['Done', 'urgent'],
      ],
      0,
      1,
    );
    const pasted = readPaste(values, target());
    const made = pasted.newOptions.get(PROPS.priority) ?? [];
    expect(made.map((o) => o.name)).toEqual(['Urgent']);
    expect(written(pasted.writes)).toEqual([
      ['row-sink', PROPS.priority, made[0]?.id],
      ['row-heater', PROPS.status, STATUS.done],
      ['row-heater', PROPS.priority, made[0]?.id],
    ]);
    expect(pasted.newOptions.has(PROPS.status)).toBe(false);
    expect(pasted.skipped).toBe(1);
  });

  it('skips and counts what it can’t paste', () => {
    const values: PastedValue[] = [
      // Needs an option, and options can't be added.
      { row: 0, column: 2, text: 'Urgent' },
      // A cell this person can't change.
      { row: 1, column: 0, text: 'New name' },
      // Someone not found.
      { row: 1, column: 3, text: 'Sam Reyes' },
      // Past the last line, and rows can't be added.
      { row: 4, column: 2, text: 'Low' },
      // Past the first PASTE_ROWS rows (empty values aren't counted).
      { row: PASTE_ROWS, column: 2, text: 'Low' },
      { row: PASTE_ROWS + 1, column: 2, text: ' ' },
    ];
    const pasted = readPaste(
      values,
      target({
        canAdd: false,
        canAddOptions: false,
        canEdit: (property) => property.id !== PROPS.name,
      }),
    );
    expect(pasted.writes).toEqual([]);
    expect(pasted.newRows).toEqual([]);
    expect(pasted.newOptions.size).toBe(0);
    expect(pasted.skipped).toBe(5);
  });

  it('adds options only up to the 1,000 a property holds', () => {
    const priority = byId.get(PROPS.priority);
    if (priority?.config.type !== 'select') throw new Error('No Priority');
    const room = REQUEST_LIMITS.options - priority.config.options.length;
    const full = {
      ...priority,
      config: {
        ...priority.config,
        options: [
          ...priority.config.options,
          ...Array.from({ length: room - 1 }, (_, i) => ({
            id: `opt-${i}`,
            name: `Option ${i}`,
            color: 'gray' as const,
          })),
        ],
      },
    };
    const values = pastedValues([['Urgent'], ['Later']], 0, 0);
    const pasted = readPaste(values, target({ properties: [full] }));
    expect(pasted.newOptions.get(PROPS.priority)?.map((o) => o.name)).toEqual(['Urgent']);
    expect(pasted.writes).toHaveLength(1);
    expect(pasted.skipped).toBe(1);
  });
});

describe('withSavedIds', () => {
  it('writes the ids addOptions saved', () => {
    const pasted = readPaste(pastedValues([['Urgent'], ['Urgent'], ['Low']], 1, 2), target());
    const typed = pasted.newOptions.get(PROPS.priority)?.[0]?.id ?? '';
    const saved = withSavedIds(pasted, new Map([[PROPS.priority, { [typed]: PRIORITY.high }]]));
    expect(written(saved.writes)).toEqual([
      ['row-heater', PROPS.priority, PRIORITY.high],
      ['row-boiler', PROPS.priority, PRIORITY.high],
      ['row-drain', PROPS.priority, PRIORITY.low],
    ]);
    expect(saved.newOptions.size).toBe(0);
  });

  it('skips values whose options couldn’t be added; a new row left empty isn’t added', () => {
    const pasted = readPaste(
      pastedValues(
        [
          ['', '', 'Urgent'],
          ['', '', 'High'],
          ['Fit new tap', '', 'Urgent'],
        ],
        4,
        0,
      ),
      target({ top: 4 }),
    );
    const saved = withSavedIds(pasted, new Map([[PROPS.priority, null]]));
    expect(saved.writes).toEqual([]);
    expect(saved.newRows).toEqual([
      { values: { [PROPS.priority]: PRIORITY.high } },
      { title: 'Fit new tap' },
    ]);
    expect(saved.skipped).toBe(2);
  });
});
