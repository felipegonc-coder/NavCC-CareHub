import type { DatabaseMeta, Property, ViewPropertySetting } from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import type { QueryRow } from '../contract';
import { fixtureRow, jobsProperties, jobsRows, PROPS, queryRow, USERS } from '../fixtures';
import { PROPERTY_TEXT } from './messages';
import {
  addedProperty,
  canChangeProperties,
  checkPropertyName,
  clearedByChange,
  hideInView,
  NEW_PROPERTY_TYPES,
  newPropertyTypes,
  placeInView,
  rowsWithValues,
  typeChoices,
  uniquePropertyName,
  viewColumns,
} from './property-logic';
import { cellCtx, prop } from './test-helpers';

const props = jobsProperties();
const byId = (id: string): Property => {
  const found = props.find((p) => p.id === id);
  if (!found) throw new Error(`no property ${id}`);
  return found;
};
const rows = jobsRows().map(queryRow);
const verification = prop({ type: 'verification' }, 'Verification');
const verified = {
  state: 'verified',
  verifiedBy: USERS.jordan.id,
  verifiedAt: '2026-10-20T15:00:00Z',
  until: '2027-01-20',
};
const people = [
  { id: USERS.avery.id, name: USERS.avery.name, email: 'avery@bluepine.example' },
  { id: USERS.jordan.id, name: USERS.jordan.name },
];

describe('canChangeProperties', () => {
  it('needs Can edit or Full access with Lock structure off', () => {
    expect(canChangeProperties({ viewerAccess: 'edit', locked: false })).toBe(true);
    expect(canChangeProperties({ viewerAccess: 'full', locked: false })).toBe(true);
    expect(canChangeProperties({ viewerAccess: 'full', locked: true })).toBe(false);
    const others: DatabaseMeta['viewerAccess'][] = [
      'edit_content',
      'comment',
      'view',
      'rows_only',
      'none',
    ];
    for (const viewerAccess of others) {
      expect(canChangeProperties({ viewerAccess, locked: false })).toBe(false);
    }
  });
});

describe('checkPropertyName', () => {
  it('wants 1 to 100 characters', () => {
    expect(checkPropertyName('', props)).toBe(PROPERTY_TEXT.nameEmpty);
    expect(checkPropertyName('   ', props)).toBe(PROPERTY_TEXT.nameEmpty);
    expect(checkPropertyName('a'.repeat(101), props)).toBe(PROPERTY_TEXT.nameTooLong);
    expect(checkPropertyName(` ${'a'.repeat(100)} `, props)).toBeNull();
  });

  it('refuses a name another property has, ignoring case and spaces', () => {
    expect(checkPropertyName('cost', props)).toBe('A property named "cost" already exists.');
    expect(checkPropertyName('DueDate', props)).toBe(PROPERTY_TEXT.nameTaken('DueDate'));
    expect(checkPropertyName('Invoice', props)).toBeNull();
  });

  it('lets a property keep its own name in another case', () => {
    expect(checkPropertyName('COST', props, PROPS.cost)).toBeNull();
    expect(checkPropertyName('Notes', props, PROPS.cost)).toBe(PROPERTY_TEXT.nameTaken('Notes'));
  });
});

describe('uniquePropertyName', () => {
  it('numbers a name that is taken', () => {
    expect(uniquePropertyName('Number', props)).toBe('Number');
    expect(uniquePropertyName('Status', props)).toBe('Status 2');
    const more = [...props, prop({ type: 'text' }, 'status 2')];
    expect(uniquePropertyName('Status', more)).toBe('Status 3');
  });
});

describe('typeChoices', () => {
  it('offers Text the types it converts into, in menu order', () => {
    expect(typeChoices(byId(PROPS.notes))).toEqual([
      'number',
      'select',
      'multi_select',
      'status',
      'date',
      'checkbox',
      'url',
      'email',
      'phone',
      'person',
    ]);
  });

  it('moves between option types, and anything else only to Text', () => {
    expect(typeChoices(byId(PROPS.status))).toEqual(['text', 'select', 'multi_select']);
    expect(typeChoices(byId(PROPS.cost))).toEqual(['text']);
    expect(typeChoices(byId(PROPS.technician))).toEqual(['text']);
  });

  it('never changes Name, and nothing turns into Formula, Rollup, ID, Button or Verification', () => {
    expect(typeChoices(byId(PROPS.name))).toEqual([]);
    const id = prop({ type: 'unique_id', prefix: 'JOB' });
    expect(typeChoices(id)).toEqual(['text', 'number']);
    const formula = prop({ type: 'formula', expression: '1', resultKind: 'number', number: null });
    expect(typeChoices(formula)).toEqual(['text']);
    expect(typeChoices(verification)).toEqual(['text']);
    for (const p of props) {
      for (const added of ['formula', 'rollup', 'unique_id', 'button', 'verification'] as const) {
        expect(typeChoices(p)).not.toContain(added);
      }
    }
  });
});

describe('NEW_PROPERTY_TYPES', () => {
  it('lists every type but Name, Relation and Rollup', () => {
    expect(NEW_PROPERTY_TYPES).not.toContain('title');
    expect(NEW_PROPERTY_TYPES).not.toContain('relation');
    expect(NEW_PROPERTY_TYPES).not.toContain('rollup');
    expect(NEW_PROPERTY_TYPES[0]).toBe('text');
    expect(NEW_PROPERTY_TYPES).toContain('formula');
    expect(NEW_PROPERTY_TYPES).toContain('unique_id');
    expect(NEW_PROPERTY_TYPES).toContain('button');
  });
});

describe('newPropertyTypes', () => {
  it('offers Verification in wiki databases only', () => {
    const notWiki = NEW_PROPERTY_TYPES.filter((t) => t !== 'verification');
    expect(newPropertyTypes({})).toEqual(notWiki);
    expect(newPropertyTypes({ wiki: false })).toEqual(notWiki);
    expect(newPropertyTypes({ wiki: true })).toEqual(NEW_PROPERTY_TYPES);
    expect(NEW_PROPERTY_TYPES).toContain('verification');
  });
});

describe('clearedByChange', () => {
  const ctx = cellCtx();

  it('counts text that does not fit the new type', () => {
    expect(clearedByChange(byId(PROPS.notes), 'number', rows, ctx, props)).toBe(1);
    expect(clearedByChange(byId(PROPS.notes), 'select', rows, ctx, props)).toBe(0);
  });

  it('clears nothing when values become text', () => {
    expect(clearedByChange(byId(PROPS.cost), 'text', rows, ctx, props)).toBe(0);
    expect(clearedByChange(byId(PROPS.technician), 'text', rows, ctx, props)).toBe(0);
  });

  it('matches Text to Person by exact name or email', () => {
    const contact = prop({ type: 'text' }, 'Contact');
    const text = (id: string, value: string) =>
      queryRow(fixtureRow(id, id, 1, { [contact.id]: [{ text: value }] }));
    const some = [
      text('r1', 'jordan park'),
      text('r2', 'avery@bluepine.example'),
      text('r3', 'Blue Pine Plumbing'),
    ];
    const all = [...props, contact];
    expect(clearedByChange(contact, 'person', some, ctx, all, people)).toBe(1);
    expect(clearedByChange(contact, 'person', some, ctx, all)).toBe(3);
  });

  it('keeps a formula as the text it shows', () => {
    const formula = prop({ type: 'formula', expression: '1', resultKind: 'text', number: null });
    const shown = rows.slice(0, 1).map((row): QueryRow => ({
      ...row,
      computed: { [formula.id]: { kind: 'text', value: 'Due soon' } },
    }));
    expect(clearedByChange(formula, 'text', shown, ctx, [...props, formula])).toBe(0);
  });
});

describe('rowsWithValues', () => {
  it('counts rows with a stored value', () => {
    expect(rowsWithValues(byId(PROPS.cost), rows)).toBe(3);
    expect(rowsWithValues(byId(PROPS.notes), rows)).toBe(1);
    expect(rowsWithValues(byId(PROPS.status), rows)).toBe(4);
  });

  it('does not count unticked boxes or automatic values', () => {
    expect(rowsWithValues(byId(PROPS.paid), rows)).toBe(1);
    expect(rowsWithValues(prop({ type: 'created_by' }), rows)).toBe(0);
  });

  it('counts verified and expired rows, not Not verified ones', () => {
    const expired = { ...verified, state: 'expired', until: '2026-10-01' };
    const some = [
      queryRow(fixtureRow('r1', 'Shutoff valves', 1, { [verification.id]: verified })),
      queryRow(fixtureRow('r2', 'Water heaters', 2, { [verification.id]: expired })),
      queryRow(fixtureRow('r3', 'Drain care', 3)),
    ];
    expect(rowsWithValues(verification, some)).toBe(2);
  });
});

describe('view columns', () => {
  const columns: ViewPropertySetting[] = [
    { propertyId: 'a', visible: true },
    { propertyId: 'b', visible: true, width: 200 },
    { propertyId: 'c', visible: false },
  ];
  const ids = (list: readonly ViewPropertySetting[]) => list.map((c) => c.propertyId);

  it('places a new property left or right of another', () => {
    expect(ids(placeInView(columns, 'b', 'x', 'right'))).toEqual(['a', 'b', 'x', 'c']);
    expect(ids(placeInView(columns, 'a', 'x', 'left'))).toEqual(['x', 'a', 'b', 'c']);
    expect(placeInView(columns, 'a', 'x', 'left')[0]).toEqual({ propertyId: 'x', visible: true });
  });

  it('puts it at the end when the other is not listed, and moves one already there', () => {
    expect(ids(placeInView(columns, 'zz', 'x', 'right'))).toEqual(['a', 'b', 'c', 'x']);
    expect(ids(placeInView(columns, 'a', 'c', 'right'))).toEqual(['a', 'c', 'b']);
  });

  it('hides one column and keeps its settings', () => {
    expect(hideInView(columns, 'b')).toEqual([
      { propertyId: 'a', visible: true },
      { propertyId: 'b', visible: false, width: 200 },
      { propertyId: 'c', visible: false },
    ]);
  });

  it('reads the view from a settings answer, or keeps the screen copy', () => {
    const view = { id: 'v1', properties: columns };
    const newer = [{ propertyId: 'a', visible: true }];
    expect(viewColumns({ views: [{ id: 'v1', properties: newer }] }, view)).toBe(newer);
    expect(viewColumns({ views: [] }, view)).toBe(columns);
  });

  it('finds the property a write added', () => {
    const added = prop({ type: 'text' }, 'Invoice');
    expect(addedProperty(props, [...props, added])).toBe(added);
    expect(addedProperty(props, props)).toBeUndefined();
  });
});
