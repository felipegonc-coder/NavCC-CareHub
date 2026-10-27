// The database as each person sees it (decision 0200): hidden properties and what reads them are
// left out everywhere. Fictional data only.
import {
  defaultConfig,
  defaultView,
  newDatabaseSchema,
  newProperty,
  relationConfig,
  type Property,
  type View,
} from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import {
  databaseMeta,
  hideMentionTitles,
  mentionedPageIds,
  viewForViewer,
  visibleIds,
} from './meta';
import type { DatabaseRecord } from './record';

const AVERY = '6f1d2a3e-0000-4000-8000-000000000001';
const JORDAN = '6f1d2a3e-0000-4000-8000-000000000002';
const OTHER_DB = '6f1d2a3e-0000-4000-8000-0000000000d2';
const PAGE = '6f1d2a3e-0000-4000-8000-0000000000a1';

const formula = (name: string, expression: string): Property =>
  newProperty(name, { type: 'formula', expression, resultKind: null, number: null });

function fixture() {
  const schema = newDatabaseSchema();
  const name = schema.properties[0]!;
  const gate: Property = {
    ...newProperty('Gate code', defaultConfig('text')),
    access: { see: [{ type: 'user', id: AVERY }], change: null },
  };
  const copy = formula('Gate code again', `prop("${gate.id}")`);
  const status = newProperty('Status', defaultConfig('status'));
  const properties = [name, gate, copy, status];
  const record: DatabaseRecord = {
    id: '6f1d2a3e-0000-4000-8000-0000000000d1',
    workspaceId: '6f1d2a3e-0000-4000-8000-0000000000e1',
    spaceId: '6f1d2a3e-0000-4000-8000-0000000000f1',
    parentId: PAGE,
    title: 'Blue Pine Plumbing jobs',
    pageIcon: { type: 'emoji', emoji: '🔧' },
    inline: false,
    inTrash: false,
    description: [{ text: 'See ' }, { text: 'Pricing', mention: { kind: 'page', id: PAGE } }],
    properties,
    views: schema.views,
    templates: [
      { id: 't1', name: 'Leak call-out', icon: null, values: { [gate.id]: [{ text: '4421' }] } },
    ],
    accessRules: [{ id: 'r1', propertyId: name.id, level: 'view' }],
    defaultTemplateId: null,
    locked: false,
    rowPageLayout: {
      pinned: [gate.id, status.id],
      properties: 'in_page',
      comments: 'full',
      backlinks: 'list',
    },
    subItems: null,
    dependencies: null,
    deletedProperties: [],
    version: 3,
    nextUniqueNumber: 1,
    createdAt: new Date('2026-10-27T06:00:00Z'),
    updatedAt: new Date('2026-10-27T06:00:00Z'),
  };
  return { record, name, gate, copy, status };
}

describe('visibleIds', () => {
  it('hides a property off its see list, and formulas that read it', () => {
    const { record, name, gate, copy, status } = fixture();
    expect(visibleIds(record.properties, { userId: AVERY })).toEqual(
      new Set([name.id, gate.id, copy.id, status.id]),
    );
    expect(visibleIds(record.properties, { userId: JORDAN })).toEqual(
      new Set([name.id, status.id]),
    );
  });

  it('hides a rollup that reads a hidden property of a related database', () => {
    const secret: Property = {
      ...newProperty('Margin', defaultConfig('number')),
      access: { see: [{ type: 'role', id: 'role-admin' }], change: null },
    };
    const link = newProperty('Customer', relationConfig(OTHER_DB));
    const rollup = newProperty('Customer margin', {
      type: 'rollup',
      relationPropertyId: link.id,
      targetPropertyId: secret.id,
      aggregate: 'sum',
      number: null,
    });
    const related = new Map([[secret.id, secret]]);
    const props = [newDatabaseSchema().properties[0]!, link, rollup];
    expect(visibleIds(props, { userId: JORDAN }, related).has(rollup.id)).toBe(false);
    expect(
      visibleIds(props, { userId: JORDAN, roleId: 'role-admin' }, related).has(rollup.id),
    ).toBe(true);
  });
});

describe('viewForViewer', () => {
  it('leaves hidden properties out of columns, filters, sorts, groups and totals', () => {
    const { record, gate, status } = fixture();
    const view: View = {
      ...defaultView('board', record.properties),
      filter: {
        kind: 'group',
        id: 'f',
        combinator: 'and',
        children: [
          { kind: 'condition', id: 'c1', propertyId: gate.id, op: 'is_not_empty' },
          { kind: 'condition', id: 'c2', propertyId: status.id, op: 'is_not_empty' },
        ],
      },
      sorts: [{ propertyId: gate.id, direction: 'asc' }],
      grouping: { propertyId: gate.id },
      calculations: { [gate.id]: 'count_values', [status.id]: 'count_all' },
    };
    const seen = viewForViewer(view, new Set([gate.id]), true);
    expect(seen.properties.map((s) => s.propertyId)).not.toContain(gate.id);
    expect(seen.filter?.children).toHaveLength(1);
    expect(seen.sorts).toEqual([]);
    expect(seen.grouping).toBeNull();
    expect(seen.calculations).toEqual({ [status.id]: 'count_all' });
  });

  it('shows a form link only to people who can edit', () => {
    const { record } = fixture();
    const form = defaultView('form', record.properties, { databaseTitle: 'Jobs' });
    expect(viewForViewer(form, new Set(), true).form?.linkCode).not.toBe('');
    expect(viewForViewer(form, new Set(), false).form?.linkCode).toBe('');
  });
});

describe('databaseMeta', () => {
  it('answers with what this person may see, and the version', () => {
    const { record, name, gate, status } = fixture();
    const meta = databaseMeta({ record, access: 'view', viewer: { userId: JORDAN } });
    expect(meta.properties.map((p) => p.id)).toEqual([name.id, status.id]);
    expect(meta.viewerAccess).toBe('view');
    expect(meta.accessRules).toEqual([]);
    expect(meta.templates[0]?.values).toEqual({});
    expect(meta.rowPageLayout?.pinned).toEqual([status.id]);
    expect(meta.icon).toBe('🔧');
    expect(meta.version).toBe(3);
    expect(meta.wiki).toBe(false);
    expect(
      databaseMeta({
        record: { ...record, wiki: true },
        access: 'view',
        viewer: { userId: JORDAN },
      }).wiki,
    ).toBe(true);
    // Pricing is a page Jordan can't open: its title is left out.
    expect(meta.description[1]).toEqual({ text: '', mention: { kind: 'page', id: PAGE } });

    const full = databaseMeta({
      record,
      access: 'full',
      viewer: { userId: AVERY },
      openablePages: new Set([PAGE]),
    });
    expect(full.properties.map((p) => p.id)).toContain(gate.id);
    expect(full.accessRules).toHaveLength(1);
    expect(full.description[1]?.text).toBe('Pricing');
  });

  it('finds mentioned pages and hides only the ones that can’t be opened', () => {
    const { record } = fixture();
    expect(mentionedPageIds(record)).toEqual([PAGE]);
    const text = [{ text: 'a', mention: { kind: 'page' as const, id: PAGE } }];
    expect(hideMentionTitles(text, new Set([PAGE]))).toBe(text);
    expect(hideMentionTitles('plain', new Set())).toBe('plain');
  });
});
