// View changes (Databases spec 3.3): the plans behind the view routes, without a database.
// Fictional data only.
import {
  LIMITS,
  defaultConfig,
  defaultView,
  newDatabaseSchema,
  newProperty,
  type FilterGroup,
  type Property,
  type View,
  type ViewLayout,
} from '@carehub/databases';
import { INVALID_REQUEST_MESSAGE } from '@carehub/databases/schemas';
import { describe, expect, it } from 'vitest';
import type { DatabaseRecord } from './record';
import {
  VIEW_MESSAGES,
  hasOpenFormAccess,
  keepHiddenColumns,
  planDeleteView,
  planDuplicateView,
  planEditView,
  planNewView,
  planViewOrder,
  viewTabs,
  type ViewPatch,
} from './views';

const JOBS = '6f1d2a3e-0000-4000-8000-0000000000d1';
const AVERY = '6f1d2a3e-0000-4000-8000-0000000000a1';
const JORDAN = '6f1d2a3e-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-10-27T06:00:00Z');
const CODE = 'q5Jx0bM2vS8yTn4LcW7dKA';

/** Blue Pine Plumbing's jobs: Name, Status, Notes, Visit (date), Photos and Crew (relation). */
function jobs(): DatabaseRecord {
  const [name] = newDatabaseSchema().properties;
  const properties: Property[] = [
    name!,
    newProperty('Status', defaultConfig('status')),
    newProperty('Notes', defaultConfig('text')),
    newProperty('Visit', defaultConfig('date')),
    newProperty('Photos', defaultConfig('files')),
    newProperty('Crew', {
      type: 'relation',
      targetDatabaseId: JOBS,
      twoWayPropertyId: null,
      single: false,
    }),
  ];
  return {
    id: JOBS,
    workspaceId: '6f1d2a3e-0000-4000-8000-0000000000e1',
    spaceId: '6f1d2a3e-0000-4000-8000-0000000000f1',
    parentId: null,
    title: 'Blue Pine Plumbing jobs',
    pageIcon: null,
    inline: false,
    inTrash: false,
    description: [],
    properties,
    views: [defaultView('table', properties), defaultView('board', properties)],
    templates: [],
    accessRules: [],
    defaultTemplateId: null,
    locked: false,
    rowPageLayout: null,
    subItems: null,
    dependencies: null,
    deletedProperties: [],
    version: 1,
    nextUniqueNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const prop = (record: DatabaseRecord, name: string): Property => {
  const found = record.properties.find((p) => p.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

const viewNamed = (views: readonly View[], name: string): View => {
  const found = views.find((v) => v.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

/** The HTTP status a plan refuses with. */
function statusOf(plan: () => unknown): number | undefined {
  try {
    plan();
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
  return undefined;
}

/** The record with a view added, as the route would save it. */
function withView(record: DatabaseRecord, layout: ViewLayout, dashboardId?: string) {
  const plan = planNewView(record, { layout, dashboardId, linkCode: CODE });
  return { record: { ...record, views: plan.views }, view: plan.view };
}

const avery = (hidden: string[] = []) => ({ userId: AVERY, hidden: new Set(hidden) });
const edit = (record: DatabaseRecord, viewId: string, patch: ViewPatch, hidden: string[] = []) =>
  planEditView(record, viewId, patch, avery(hidden));

describe('new views', () => {
  it('numbers a taken layout name and puts the view last, or after another', () => {
    const record = jobs();
    const board = planNewView(record, { layout: 'board' });
    expect(board.view.name).toBe('Board 2');
    expect(board.views.at(-1)?.id).toBe(board.view.id);
    expect(board.view.grouping?.propertyId).toBe(prop(record, 'Status').id);
    const first = record.views[0]!;
    const list = planNewView(record, { layout: 'list', name: 'Today', afterViewId: first.id });
    expect(list.views.map((v) => v.name)).toEqual(['Table', 'Today', 'Board']);
    expect(statusOf(() => planNewView(record, { layout: 'list', afterViewId: 'gone' }))).toBe(400);
  });

  it('gives a form the link code it is sent', () => {
    const { view } = withView(jobs(), 'form');
    expect(view.form?.linkCode).toBe(CODE);
    expect(view.form?.linkChangedAt).toBeNull();
    expect(view.form?.title).toBe('Blue Pine Plumbing jobs');
  });

  it('stops at 100 views', () => {
    const record = jobs();
    const many = Array.from({ length: LIMITS.views }, () => defaultView('list', record.properties));
    expect(() => planNewView({ ...record, views: many }, { layout: 'table' })).toThrow(
      VIEW_MESSAGES.tooMany,
    );
  });

  it('adds dashboard tiles as views with a widget each, up to 12', () => {
    const { record, view: dashboard } = withView(jobs(), 'dashboard');
    expect(dashboard.dashboard).toEqual({ widgets: [] });
    const tile = planNewView(record, { layout: 'chart', dashboardId: dashboard.id });
    expect(tile.view.dashboardId).toBe(dashboard.id);
    const saved = viewNamed(tile.views, 'Dashboard');
    expect(saved.dashboard?.widgets).toEqual([
      { id: expect.any(String), viewId: tile.view.id, width: 2, height: 'm' },
    ]);
    expect(viewTabs(tile.views).map((v) => v.name)).toEqual(['Table', 'Board', 'Dashboard']);
    const gallery = () => planNewView(record, { layout: 'gallery', dashboardId: dashboard.id });
    expect(gallery).toThrow(INVALID_REQUEST_MESSAGE);
    const table = record.views[0]!;
    expect(statusOf(() => planNewView(record, { layout: 'list', dashboardId: table.id }))).toBe(
      400,
    );
    let full = record;
    for (let i = 0; i < LIMITS.dashboardWidgets; i++) {
      full = withView(full, 'list', dashboard.id).record;
    }
    expect(() => planNewView(full, { layout: 'list', dashboardId: dashboard.id })).toThrow(
      VIEW_MESSAGES.tooManyWidgets,
    );
  });
});

describe('changing a view', () => {
  it('renames and changes settings, checked against the properties', () => {
    const record = jobs();
    const table = record.views[0]!;
    const status = prop(record, 'Status');
    const plan = edit(record, table.id, {
      name: 'Open jobs',
      sorts: [{ propertyId: status.id, direction: 'asc' }],
    });
    expect(plan.view.name).toBe('Open jobs');
    expect(plan.views[0]).toBe(plan.view);
    expect(plan.structure).toBe(true);
    const crew = prop(record, 'Crew');
    const notes = prop(record, 'Notes');
    expect(() =>
      edit(record, table.id, { sorts: [{ propertyId: crew.id, direction: 'asc' }] }),
    ).toThrow(VIEW_MESSAGES.sort);
    expect(() =>
      edit(record, table.id, {
        grouping: {
          propertyId: prop(record, 'Photos').id,
          sort: 'manual',
          order: [],
          hidden: [],
          hideEmpty: false,
        },
      }),
    ).toThrow(VIEW_MESSAGES.group);
    expect(() => edit(record, table.id, { calculations: { [notes.id]: 'sum' } })).toThrow(
      VIEW_MESSAGES.calculation,
    );
    expect(statusOf(() => edit(record, 'gone', { name: 'x' }))).toBe(404);
    expect(statusOf(() => edit(record, table.id, { defaultTemplateId: 'gone' }))).toBe(400);
  });

  it('switches layouts with the new layout defaults, but not to or from forms and dashboards', () => {
    const record = jobs();
    const table = record.views[0]!;
    const board = edit(record, table.id, { layout: 'board' }).view;
    expect(board.layout).toBe('board');
    expect(board.grouping?.propertyId).toBe(prop(record, 'Status').id);
    expect(board.board?.cardPreview).toEqual({ kind: 'none' });
    expect(board.table).toEqual(table.table);
    const calendar = edit(record, table.id, { layout: 'calendar' }).view;
    expect(calendar.calendar?.showBy).toBe(prop(record, 'Visit').id);
    expect(statusOf(() => edit(record, table.id, { layout: 'form' }))).toBe(400);
    const { record: withDashboard, view: dashboard } = withView(record, 'dashboard');
    expect(statusOf(() => edit(withDashboard, dashboard.id, { layout: 'table' }))).toBe(400);
    const tile = withView(withDashboard, 'list', dashboard.id);
    expect(statusOf(() => edit(tile.record, tile.view.id, { layout: 'gallery' }))).toBe(400);
    expect(edit(tile.record, tile.view.id, { layout: 'table' }).view.dashboardId).toBe(
      dashboard.id,
    );
  });

  it('wants date and files properties where they belong', () => {
    const { record, view } = withView(jobs(), 'calendar');
    const notes = prop(record, 'Notes');
    const calendar = { showBy: notes.id, mode: 'month' as const, showWeekends: true };
    expect(() => edit(record, view.id, { calendar })).toThrow(VIEW_MESSAGES.date);
    const board = record.views[1]!;
    const preview = { kind: 'files' as const, propertyId: notes.id };
    expect(() =>
      edit(record, board.id, { board: { ...board.board!, cardPreview: preview } }),
    ).toThrow(VIEW_MESSAGES.files);
    const photos = { kind: 'files' as const, propertyId: prop(record, 'Photos').id };
    const ok = edit(record, board.id, { board: { ...board.board!, cardPreview: photos } });
    expect(ok.view.board?.cardPreview).toEqual(photos);
  });

  it("keeps the columns of properties the person can't see where they were", () => {
    const record = jobs();
    const table = record.views[0]!;
    const [name, status, notes, visit, photos, crew] = record.properties.map((p) => p.id);
    const sent = [status!, name!, visit!, photos!, crew!].map((id) => ({
      propertyId: id,
      visible: true,
    }));
    const plan = edit(record, table.id, { properties: sent }, [notes!]);
    expect(plan.view.properties.map((s) => s.propertyId)).toEqual([
      status,
      notes,
      name,
      visit,
      photos,
      crew,
    ]);
    const saved = table.properties.find((s) => s.propertyId === notes);
    expect(plan.view.properties[1]).toEqual(saved);
  });

  it('leaves out unknown and repeated columns', () => {
    const known = (id: string) => id !== 'gone';
    const kept = (id: string) => id === 'secret';
    const saved = [
      { propertyId: 'secret', visible: true },
      { propertyId: 'a', visible: true },
    ];
    const sent = [
      { propertyId: 'a', visible: false },
      { propertyId: 'gone', visible: true },
      { propertyId: 'a', visible: true },
      { propertyId: 'secret', visible: false },
    ];
    expect(keepHiddenColumns(saved, sent, known, kept)).toEqual([
      { propertyId: 'secret', visible: true },
      { propertyId: 'a', visible: false },
    ]);
  });

  it("lets a person only rename a view that uses a property they can't see", () => {
    const record = jobs();
    const notes = prop(record, 'Notes');
    const table = record.views[0]!;
    const sorted: DatabaseRecord = {
      ...record,
      views: record.views.map((v): View =>
        v.id === table.id ? { ...v, sorts: [{ propertyId: notes.id, direction: 'desc' }] } : v,
      ),
    };
    expect(edit(sorted, table.id, { name: 'Mine' }, [notes.id]).view.name).toBe('Mine');
    const clear = () => edit(sorted, table.id, { sorts: [] }, [notes.id]);
    expect(clear).toThrow(VIEW_MESSAGES.blocked);
    expect(statusOf(clear)).toBe(403);
    const filter: FilterGroup = {
      kind: 'group',
      id: 'g1',
      combinator: 'and',
      children: [{ kind: 'condition', id: 'c1', propertyId: notes.id, op: 'is_empty' }],
    };
    const add = () => edit(record, table.id, { filter }, [notes.id]);
    expect(add).toThrow(VIEW_MESSAGES.blocked);
  });

  it('keeps a form link, and lets people turn their own notifications on and off', () => {
    const { record, view } = withView(jobs(), 'form');
    const form = view.form!;
    const others: DatabaseRecord = {
      ...record,
      views: record.views.map((v) =>
        v.id === view.id ? { ...v, form: { ...form, notifyUserIds: [JORDAN] } } : v,
      ),
    };
    const sent = { ...form, linkCode: 'guessed', notifyUserIds: [AVERY] };
    const on = edit(others, view.id, { form: sent });
    expect(on.view.form?.linkCode).toBe(CODE);
    expect(on.view.form?.notifyUserIds).toEqual([JORDAN, AVERY]);
    expect(on.structure).toBe(false);
    expect(on.formAccess).toBe(false);
    expect(on.formResponses).toBe(false);
    const off = edit(others, view.id, { form: { ...form, notifyUserIds: [] } });
    expect(off.view.form?.notifyUserIds).toEqual([JORDAN]);
  });

  it("tells form gates apart from the form's structure", () => {
    const { record, view } = withView(jobs(), 'form');
    const form = view.form!;
    const closed = edit(record, view.id, { form: { ...form, accepting: false } });
    expect([closed.structure, closed.formAccess, closed.formResponses]).toEqual([
      false,
      false,
      true,
    ]);
    const limited = edit(record, view.id, { form: { ...form, maxResponses: 30 } });
    expect(limited.formResponses).toBe(true);
    const anonymous = edit(record, view.id, { form: { ...form, anonymous: true } });
    expect([anonymous.structure, anonymous.formAccess]).toEqual([false, true]);
    const guests = edit(record, view.id, { form: { ...form, audience: 'members_and_guests' } });
    expect(guests.formAccess).toBe(true);
    const same = edit(record, view.id, { form: { ...form, audience: 'members' } });
    expect([same.structure, same.formAccess]).toEqual([false, false]);
    const renamed = edit(record, view.id, { form: { ...form, title: 'Book a visit' } });
    expect([renamed.structure, renamed.formAccess, renamed.formResponses]).toEqual([
      true,
      false,
      false,
    ]);
    const notes = prop(record, 'Notes');
    const question = { ...form.questions[0]!, propertyId: notes.id, text: 'Notes' };
    const twice = { ...form, questions: [question, question] };
    expect(() => edit(record, view.id, { form: twice })).toThrow("'Notes' is already a question.");
    expect(statusOf(() => edit(record, record.views[0]!.id, { form }))).toBe(400);
  });

  it("moves a dashboard's widgets, but only its own tiles", () => {
    const { record, view: dashboard } = withView(jobs(), 'dashboard');
    const one = withView(record, 'chart', dashboard.id);
    const two = withView(one.record, 'list', dashboard.id);
    const widgets = viewNamed(two.record.views, 'Dashboard').dashboard!.widgets;
    const moved = edit(two.record, dashboard.id, {
      dashboard: { widgets: [{ ...widgets[1]!, width: 4 }, widgets[0]!] },
    });
    expect(moved.view.dashboard?.widgets.map((w) => w.viewId)).toEqual([two.view.id, one.view.id]);
    const missing = () => edit(two.record, dashboard.id, { dashboard: { widgets: [widgets[0]!] } });
    expect(statusOf(missing)).toBe(400);
    const table = two.record.views[0]!;
    const stranger = { ...widgets[0]!, viewId: table.id };
    const wrong = () =>
      edit(two.record, dashboard.id, { dashboard: { widgets: [stranger, widgets[1]!] } });
    expect(statusOf(wrong)).toBe(400);
  });
});

describe('deleting a view', () => {
  it('removes the view but never the last tab', () => {
    const record = jobs();
    const [table, board] = record.views;
    const plan = planDeleteView(record, board!.id);
    expect(plan.views.map((v) => v.id)).toEqual([table!.id]);
    expect(plan.removedIds).toEqual([board!.id]);
    const one = { ...record, views: plan.views };
    expect(() => planDeleteView(one, table!.id)).toThrow(VIEW_MESSAGES.lastView);
    expect(statusOf(() => planDeleteView(record, 'gone'))).toBe(404);
  });

  it("takes a dashboard's tiles with it, and a tile out of its dashboard", () => {
    const { record, view: dashboard } = withView(jobs(), 'dashboard');
    const one = withView(record, 'chart', dashboard.id);
    const two = withView(one.record, 'list', dashboard.id);
    const tile = planDeleteView(two.record, one.view.id);
    const left = viewNamed(tile.views, 'Dashboard').dashboard!.widgets.map((w) => w.viewId);
    expect(left).toEqual([two.view.id]);
    const all = planDeleteView(two.record, dashboard.id);
    expect(all.removedIds.sort()).toEqual([dashboard.id, one.view.id, two.view.id].sort());
    expect(all.views.map((v) => v.name)).toEqual(['Table', 'Board']);
    const onlyDashboard = { ...two.record, views: two.record.views.slice(2) };
    expect(() => planDeleteView(onlyDashboard, dashboard.id)).toThrow(VIEW_MESSAGES.lastView);
  });
});

describe('duplicating a view', () => {
  it('copies every setting under a new name, right after it', () => {
    const record = jobs();
    const table = record.views[0]!;
    const plan = planDuplicateView(record, table.id);
    expect(plan.view.name).toBe('Table 2');
    expect(plan.view.id).not.toBe(table.id);
    expect({ ...plan.view, id: table.id, name: table.name }).toEqual(table);
    expect(plan.views.map((v) => v.name)).toEqual(['Table', 'Table 2', 'Board']);
    plan.view.properties[0]!.visible = false;
    expect(table.properties[0]!.visible).toBe(true);
  });

  it('gives a form copy its own link and no one to notify', () => {
    const { record, view } = withView(jobs(), 'form');
    const noted = {
      ...record,
      views: record.views.map((v) =>
        v.id === view.id ? { ...v, form: { ...v.form!, notifyUserIds: [JORDAN] } } : v,
      ),
    };
    const copy = planDuplicateView(noted, view.id, 'Zt3mV9pQx1sRk7LwYb2cHg').view;
    expect(copy.form?.linkCode).toBe('Zt3mV9pQx1sRk7LwYb2cHg');
    expect(copy.form?.notifyUserIds).toEqual([]);
    expect(hasOpenFormAccess(copy)).toBe(false);
    expect(hasOpenFormAccess({ ...copy, form: { ...copy.form!, anonymous: true } })).toBe(true);
    expect(hasOpenFormAccess({ ...copy, form: { ...copy.form!, audience: 'anyone' } })).toBe(true);
  });

  it("copies a dashboard's tiles, and a tile into its dashboard", () => {
    const { record, view: dashboard } = withView(jobs(), 'dashboard');
    const one = withView(record, 'chart', dashboard.id);
    const copy = planDuplicateView(one.record, dashboard.id);
    const tiles = copy.views.filter((v) => v.dashboardId === copy.view.id);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.id).not.toBe(one.view.id);
    expect(copy.view.dashboard?.widgets.map((w) => w.viewId)).toEqual([tiles[0]!.id]);
    const tileCopy = planDuplicateView(one.record, one.view.id);
    expect(tileCopy.view.dashboardId).toBe(dashboard.id);
    const widgets = viewNamed(tileCopy.views, 'Dashboard').dashboard!.widgets;
    expect(widgets.map((w) => w.viewId)).toEqual([one.view.id, tileCopy.view.id]);
  });

  it('stops at 100 views', () => {
    const record = jobs();
    const many = Array.from({ length: LIMITS.views }, () => defaultView('list', record.properties));
    expect(() => planDuplicateView({ ...record, views: many }, many[0]!.id)).toThrow(
      VIEW_MESSAGES.tooMany,
    );
  });
});

describe('ordering views', () => {
  it('orders the tabs and keeps dashboard tiles after them', () => {
    const { record, view: dashboard } = withView(jobs(), 'dashboard');
    const tile = withView(record, 'chart', dashboard.id);
    const [table, board] = record.views;
    const order = [dashboard.id, board!.id, table!.id];
    expect(planViewOrder(tile.record, order).map((v) => v.id)).toEqual([...order, tile.view.id]);
    for (const wrong of [
      [board!.id, table!.id],
      [dashboard.id, board!.id, board!.id],
      [dashboard.id, board!.id, tile.view.id],
      [dashboard.id, board!.id, table!.id, 'gone'],
    ]) {
      expect(statusOf(() => planViewOrder(tile.record, wrong))).toBe(400);
    }
  });
});
