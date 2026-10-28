/**
 * What leaves the engine for one row (spec 3.4 Relations, 3.12): only values of properties the
 * viewer can see, formula and rollup results, links only to rows they can open (with a count of
 * the others), and created and edited details only when a property showing them is visible.
 */
import type { RowColor } from '../color';
import type { ComputedValue, Id, Property, PropertyType, Row } from '../types';
import { HIDDEN_ROW_ID, type ArrangedLine, type ComputeContext, type QueryRow } from './shapes';

/** The row fields each automatic property shows. */
const META: readonly [
  PropertyType,
  'createdAt' | 'editedAt' | 'createdBy' | 'editedBy' | 'uniqueNumber',
][] = [
  ['created_time', 'createdAt'],
  ['edited_time', 'editedAt'],
  ['created_by', 'createdBy'],
  ['edited_by', 'editedBy'],
  ['unique_id', 'uniqueNumber'],
];

/** How rows are turned into what the viewer gets. */
export interface Projection {
  /** The properties the viewer can see. */
  properties: readonly Property[];
  ctx: ComputeContext;
  /** Row fields to leave out: every property that shows them is hidden. */
  hiddenMeta: ReadonlySet<string>;
  /** Titles of the linked rows the viewer can open, filled in as rows are projected. */
  titles: Record<Id, string>;
  /** The row's conditional color (rowColorer, with the view's rules prepared once). */
  colorOf(row: Row): RowColor;
}

/** Row fields whose properties exist but are all hidden from the viewer. */
export function hiddenMetaFields(all: readonly Property[], visible: ReadonlySet<Id>): Set<string> {
  const out = new Set<string>();
  for (const [type, field] of META) {
    const props = all.filter((p) => p.config.type === type);
    if (props.length && !props.some((p) => visible.has(p.id))) out.add(field);
  }
  return out;
}

/**
 * A row with the values of hidden properties (and of deleted ones) taken out, so nothing later in
 * the query, formulas included, can read them. The same object when nothing is hidden.
 */
export function withoutHidden(row: Row, keep: ReadonlySet<Id>, stripping: boolean): Row {
  if (!stripping) return row;
  const values: Row['values'] = {};
  for (const [id, value] of Object.entries(row.values)) if (keep.has(id)) values[id] = value;
  return { ...row, values };
}

/** Replaces rows the viewer can't open in a formula or rollup result with HIDDEN_ROW_ID. */
function hideRows(value: ComputedValue, p: Projection): ComputedValue {
  if (value.kind === 'page') {
    const title = p.ctx.rowTitle?.(value.value);
    if (title === undefined) return { kind: 'page', value: HIDDEN_ROW_ID };
    p.titles[value.value] = title;
    return value;
  }
  if (value.kind !== 'list') return value;
  let changed = false;
  const items = value.value.map((item) => {
    const next = hideRows(item, p);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { kind: 'list', value: items } : value;
}

const ids = (v: unknown): Id[] =>
  Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string' && x !== '') : [];

/** The row as this viewer gets it. `placed` adds where a sub-item line sits. */
export function projectRow(line: ArrangedLine, p: Projection, placed: boolean): QueryRow {
  const row = line.row;
  const out: QueryRow = {
    id: row.id,
    title: row.title,
    icon: row.icon ?? null,
    formId: row.formId ?? null,
    values: {},
    computed: {},
    hiddenLinks: {},
    color: p.colorOf(row),
    createdAt: p.hiddenMeta.has('createdAt') ? null : row.createdAt,
    createdBy: p.hiddenMeta.has('createdBy') ? null : row.createdBy,
    editedAt: p.hiddenMeta.has('editedAt') ? null : row.editedAt,
    editedBy: p.hiddenMeta.has('editedBy') ? null : row.editedBy,
    uniqueNumber: p.hiddenMeta.has('uniqueNumber') ? null : row.uniqueNumber,
  };
  for (const prop of p.properties) {
    const type = prop.config.type;
    if (type === 'formula' || type === 'rollup') {
      out.computed[prop.id] = hideRows(p.ctx.computed(row, prop.id), p);
      continue;
    }
    const value = row.values[prop.id];
    if (value === undefined || value === null || type === 'title') continue;
    if (type !== 'relation') {
      out.values[prop.id] = value;
      continue;
    }
    const links = ids(value);
    const open = links.filter((id) => {
      const title = p.ctx.rowTitle?.(id);
      if (title !== undefined) p.titles[id] = title;
      return title !== undefined;
    });
    if (open.length) out.values[prop.id] = open;
    if (links.length > open.length) out.hiddenLinks[prop.id] = links.length - open.length;
  }
  if (placed) {
    out.depth = line.depth;
    out.parentId = line.parentId;
    out.childCount = line.childCount;
    out.context = line.context;
  }
  return out;
}
