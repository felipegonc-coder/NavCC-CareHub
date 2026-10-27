import { describe, expect, it } from 'vitest';
import { readValue, isEmptyValue, titleProperty } from './row';
import {
  defaultConfig,
  defaultView,
  newDatabaseSchema,
  newProperty,
  uniqueViewName,
} from './schema';
import { VIEW_LAYOUTS, type Row } from './types';

const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1',
  title: '',
  values: {},
  createdAt: '2026-10-26T15:00:00.000Z',
  createdBy: 'u1',
  editedAt: '2026-10-26T16:00:00.000Z',
  editedBy: 'u2',
  uniqueNumber: 7,
  ...over,
});

describe('schema defaults', () => {
  it('makes a new database with Name and a Table view (DB-01)', () => {
    const { properties, views } = newDatabaseSchema();
    expect(properties.map((p) => [p.name, p.config.type])).toEqual([['Name', 'title']]);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ name: 'Table', layout: 'table', sorts: [], filter: null });
  });
  it('picks a board grouping and names views', () => {
    const props = [
      newProperty('Name', defaultConfig('title')),
      newProperty('Tags', defaultConfig('multi_select')),
      newProperty('Status', defaultConfig('status')),
    ];
    expect(defaultView('board', props).grouping?.propertyId).toBe(props[2]!.id);
    expect(uniqueViewName('Board', ['Board', 'board 2'])).toBe('Board 3');
  });
  it('starts Status with three options in three groups', () => {
    const s = defaultConfig('status');
    expect(s.options.map((o) => [o.name, o.group])).toEqual([
      ['Not started', 'todo'],
      ['In progress', 'in_progress'],
      ['Done', 'complete'],
    ]);
    expect(s.defaultOptionId).toBe(s.options[0]!.id);
  });
});

describe('readValue', () => {
  const props = [
    newProperty('Name', defaultConfig('title')),
    newProperty('Done', defaultConfig('checkbox')),
    newProperty('Made by', defaultConfig('created_by')),
    newProperty('Edited', defaultConfig('edited_time')),
    newProperty('ID', defaultConfig('unique_id')),
    newProperty('Score', defaultConfig('formula')),
  ];
  const [name, done, madeBy, edited, uid, score] = props;
  it('fills automatic properties and treats "" as empty', () => {
    const r = row();
    expect(readValue(r, titleProperty(props))).toBeNull();
    expect(readValue(r, done!)).toBe(false);
    expect(readValue(r, madeBy!)).toEqual(['u1']);
    expect(readValue(r, edited!)).toEqual({
      start: '2026-10-26T16:00:00.000Z',
      end: null,
      hasTime: true,
    });
    expect(readValue(r, uid!)).toBe('7');
    expect(readValue(row({ createdBy: null }), madeBy!)).toBeNull();
    expect(isEmptyValue(readValue(r, name!))).toBe(true);
  });
  it('asks the context for computed values', () => {
    expect(readValue(row(), score!, { computed: () => ({ kind: 'number', value: 3 }) })).toEqual({
      kind: 'number',
      value: 3,
    });
    expect(isEmptyValue(readValue(row(), score!))).toBe(true);
  });
});

describe('view defaults from the v2 spec', () => {
  it('loads 50 rows per group in every layout', () => {
    const { properties } = newDatabaseSchema();
    for (const layout of VIEW_LAYOUTS) {
      expect(defaultView(layout, properties).loadLimit).toBe(50);
    }
  });

  it('makes Feed and Dashboard views', () => {
    const { properties } = newDatabaseSchema();
    expect(defaultView('feed', properties)).toMatchObject({
      name: 'Feed',
      feed: { showContent: true, showComments: true },
    });
    expect(defaultView('dashboard', properties)).toMatchObject({
      name: 'Dashboard',
      dashboard: { widgets: [] },
    });
  });
});

describe('reading stored web addresses (issue #12)', () => {
  const url = newProperty('Website', defaultConfig('url'));
  it('returns safe links and drops unsafe ones', () => {
    expect(readValue(row({ values: { [url.id]: 'https://bluepine.example' } }), url)).toBe(
      'https://bluepine.example',
    );
    for (const bad of ['javascript:alert(1)', ' https://x.example', 'https://u@evil.example', 42]) {
      expect(readValue(row({ values: { [url.id]: bad } }), url)).toBeNull();
    }
  });
});
