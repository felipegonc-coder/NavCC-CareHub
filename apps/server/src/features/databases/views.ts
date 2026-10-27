// View changes (decision 0200; Databases spec 3.3): adding, changing, deleting, duplicating and
// ordering a database's views. Pure: view-routes.ts checks access, saves the views and keeps form
// link codes in forms_links; these say what the views become, or refuse with a fixed message.
import { isDeepStrictEqual } from 'node:util';
import {
  LAYOUT_LABELS,
  LIMITS,
  defaultView,
  findProperty,
  newId,
  uniqueViewName,
  type Aggregate,
  type FormDefinition,
  type Id,
  type Property,
  type View,
  type ViewLayout,
  type ViewPropertySetting,
} from '@carehub/databases';
import { aggregatesFor } from '@carehub/databases/aggregate';
import { validateChartOptions } from '@carehub/databases/chart';
import { validateColorRules } from '@carehub/databases/color';
import { viewPropertyIds } from '@carehub/databases/engine';
import { validateFilter } from '@carehub/databases/filter';
import { validateFormDefinition } from '@carehub/databases/forms';
import { canGroupBy } from '@carehub/databases/group';
import { canSortBy } from '@carehub/databases/sort';
import { forbidden, invalid, invalidRequest, notFound } from './errors';
import type { DatabaseRecord } from './record';

/** Messages, word for word. */
export const VIEW_MESSAGES = {
  tooMany: 'A database can have up to 100 views.',
  lastView: "The last view can't be deleted.",
  blocked: "This view uses a property you can't see.",
  tooManyWidgets: 'A dashboard can have up to 12 widgets.',
  sort: "This property can't be used to sort.",
  group: "This property can't be used to group.",
  calculation: "This calculation doesn't fit its property.",
  date: 'Choose a date property.',
  files: 'Choose a Files & media property.',
} as const;

/** Layouts a view can switch between (a form keeps its link and a dashboard its tiles). */
const SWITCHABLE: ReadonlySet<ViewLayout> = new Set([
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
  'chart',
  'feed',
]);
/** Layouts a dashboard tile can have. */
const TILE_LAYOUTS: ReadonlySet<ViewLayout> = new Set(['table', 'board', 'list', 'chart']);
const DATE_TYPES: ReadonlySet<string> = new Set(['date', 'created_time', 'edited_time']);
/** The parts of a form that aren't its structure: Full access and personal settings. */
const FORM_GATES = [
  'accepting',
  'closeAt',
  'maxResponses',
  'audience',
  'anonymous',
  'notifyUserIds',
  'linkCode',
  'linkChangedAt',
] as const satisfies readonly (keyof FormDefinition)[];

/** A form without its gates, to tell whether its structure changed. */
function formStructure(form: FormDefinition | undefined): Partial<FormDefinition> | undefined {
  if (!form) return undefined;
  const out: Partial<FormDefinition> = { ...form };
  for (const key of FORM_GATES) delete out[key];
  return out;
}

/** The views people pick from (dashboard tiles show inside their dashboard instead). */
export const viewTabs = (views: readonly View[]): View[] =>
  views.filter((v) => v.dashboardId === undefined);

function findView(views: readonly View[], id: Id): View {
  const view = views.find((v) => v.id === id);
  if (!view) throw notFound();
  return view;
}

const withDashboard = (views: readonly View[], dashboard: View): View[] =>
  views.map((v) => (v.id === dashboard.id ? dashboard : v));

export interface NewViewInput {
  layout: ViewLayout;
  /** Absent: the layout's name, numbered if it's taken ("Board 2"). */
  name?: string | undefined;
  /** Put it after this view tab; absent: last. */
  afterViewId?: Id | undefined;
  /** A tile of this dashboard view (table, board, list or chart). */
  dashboardId?: Id | undefined;
  /** A form's link code (the route makes it and keeps it in forms_links). */
  linkCode?: string | undefined;
}

export interface NewViewPlan {
  view: View;
  views: View[];
}

/** A new view with the package's defaults for its layout. */
export function planNewView(current: DatabaseRecord, input: NewViewInput): NewViewPlan {
  if (current.views.length >= LIMITS.views) throw invalid(VIEW_MESSAGES.tooMany);
  const dashboard =
    input.dashboardId === undefined ? null : findView(current.views, input.dashboardId);
  if (dashboard) {
    if (dashboard.layout !== 'dashboard' || !TILE_LAYOUTS.has(input.layout)) {
      throw invalidRequest();
    }
    if ((dashboard.dashboard?.widgets.length ?? 0) >= LIMITS.dashboardWidgets) {
      throw invalid(VIEW_MESSAGES.tooManyWidgets);
    }
  }
  const names = current.views.map((v) => v.name);
  const name = input.name ?? uniqueViewName(LAYOUT_LABELS[input.layout], names);
  const view = defaultView(input.layout, current.properties, {
    name,
    databaseTitle: current.title,
  });
  if (view.form && input.linkCode !== undefined) {
    view.form = { ...view.form, linkCode: input.linkCode, linkChangedAt: null };
  }
  if (input.layout === 'dashboard') view.dashboard = { widgets: [] };
  let views = [...current.views];
  if (dashboard) {
    view.dashboardId = dashboard.id;
    const widgets = [
      ...(dashboard.dashboard?.widgets ?? []),
      { id: newId(), viewId: view.id, width: 2 as const, height: 'm' as const },
    ];
    views = withDashboard(views, { ...dashboard, dashboard: { widgets } });
    views.push(view);
    return { view, views };
  }
  if (input.afterViewId === undefined) views.push(view);
  else {
    const at = views.findIndex((v) => v.id === input.afterViewId);
    if (at < 0 || views[at]?.dashboardId !== undefined) throw invalidRequest();
    views.splice(at + 1, 0, view);
  }
  return { view, views };
}

/** A change to one view: any View settings but its id and the dashboard it belongs to. */
export type ViewPatch = Partial<Omit<View, 'id' | 'dashboardId'>>;

/**
 * Column settings as sent, with the saved settings of properties `kept` says to keep (ones the
 * person can't see, and deleted ones) back after the column they followed. Settings for unknown
 * properties are left out.
 */
export function keepHiddenColumns(
  saved: readonly ViewPropertySetting[],
  sent: readonly ViewPropertySetting[],
  known: (id: Id) => boolean,
  kept: (id: Id) => boolean,
): ViewPropertySetting[] {
  const seen = new Set<Id>();
  const out = sent.filter((s) => {
    if (kept(s.propertyId) || !known(s.propertyId) || seen.has(s.propertyId)) return false;
    seen.add(s.propertyId);
    return true;
  });
  let previous: Id | null = null;
  for (const setting of saved) {
    if (kept(setting.propertyId)) {
      const at = previous === null ? -1 : out.findIndex((s) => s.propertyId === previous);
      out.splice(at + 1, 0, setting);
      previous = setting.propertyId;
    } else if (seen.has(setting.propertyId)) {
      previous = setting.propertyId;
    }
  }
  return out;
}

export interface EditViewPlan {
  before: View;
  view: View;
  views: View[];
  /**
   * The change is more than a form's gates (who answers, anonymous, open or closed, close time,
   * most responses) and notifications: it takes edit_views, and Lock structure stops it.
   */
  structure: boolean;
  /** The change sets who can answer a form or whether it's anonymous (Full access). */
  formAccess: boolean;
  /** The change opens or closes a form, or sets when it closes or how many it takes (Full access). */
  formResponses: boolean;
}

/** Who is changing a view: the person, and the properties they can't see. */
export interface ViewEditor {
  userId: Id;
  hidden: ReadonlySet<Id>;
}

/** The form takes guests' or anyone's responses, or anonymous ones: setting that takes Full access. */
export const hasOpenFormAccess = (view: View): boolean =>
  view.form !== undefined &&
  (view.form.anonymous || (view.form.audience ?? 'members') !== 'members');

/**
 * Changing a view. Columns and totals of properties the person can't see stay as saved, and a view
 * that uses one (a filter, sort, grouping and so on) can only be renamed by them. Changed settings
 * are checked against the database's properties. A form's link stays as it is ("Change link" is
 * the forms API's), and of the people notified about responses, a person can add or take out only
 * themselves. A view can switch layouts, except to or from a form or a dashboard.
 */
export function planEditView(
  current: DatabaseRecord,
  viewId: Id,
  patch: ViewPatch,
  editor: ViewEditor,
): EditViewPlan {
  const hidden = editor.hidden;
  const before = findView(current.views, viewId);
  const properties = current.properties;
  const deleted = new Set(current.deletedProperties.map((d) => d.property.id));
  const kept = (id: Id) => hidden.has(id) || deleted.has(id);
  const known = (id: Id) => findProperty(properties, id) !== undefined;
  const next: View = { ...before, ...patch, id: before.id };
  if (before.dashboardId !== undefined) next.dashboardId = before.dashboardId;
  else delete next.dashboardId;

  if (patch.layout !== undefined && patch.layout !== before.layout) {
    const tile = before.dashboardId !== undefined;
    if (!SWITCHABLE.has(before.layout) || !SWITCHABLE.has(patch.layout)) throw invalidRequest();
    if (tile && !TILE_LAYOUTS.has(patch.layout)) throw invalidRequest();
    fillLayout(next, properties);
  }
  if (patch.properties) {
    next.properties = keepHiddenColumns(before.properties, patch.properties, known, kept);
  }
  if (patch.timeline) {
    next.timeline = {
      ...patch.timeline,
      tableProperties: keepHiddenColumns(
        before.timeline?.tableProperties ?? [],
        patch.timeline.tableProperties,
        known,
        kept,
      ),
    };
  }
  if (patch.calculations) {
    const sent = Object.entries(patch.calculations).filter(([id]) => !kept(id));
    const saved = Object.entries(before.calculations).filter(([id]) => kept(id));
    next.calculations = Object.fromEntries([...sent, ...saved]);
  }
  if (Object.keys(patch).some((key) => key !== 'name')) {
    const uses = [...viewPropertyIds(before), ...viewPropertyIds(next)];
    if (uses.some((id) => hidden.has(id))) throw forbidden(VIEW_MESSAGES.blocked);
  }
  if (next.form && before.form) {
    const others = before.form.notifyUserIds.filter((id) => id !== editor.userId);
    const notifyMe = next.form.notifyUserIds.includes(editor.userId);
    next.form = {
      ...next.form,
      linkCode: before.form.linkCode,
      linkChangedAt: before.form.linkChangedAt,
      notifyUserIds: notifyMe ? [...others, editor.userId] : others,
    };
  }
  checkView(current, before, next, patch);
  const form = next.form;
  const was = before.form;
  return {
    before,
    view: next,
    views: current.views.map((v) => (v.id === next.id ? next : v)),
    structure:
      Object.keys(patch).some((key) => key !== 'form') ||
      !isDeepStrictEqual(formStructure(before.form), formStructure(next.form)),
    formAccess:
      form !== undefined &&
      was !== undefined &&
      ((form.audience ?? 'members') !== (was.audience ?? 'members') ||
        form.anonymous !== was.anonymous),
    formResponses:
      form !== undefined &&
      was !== undefined &&
      (form.accepting !== was.accepting ||
        (form.closeAt ?? null) !== (was.closeAt ?? null) ||
        (form.maxResponses ?? null) !== (was.maxResponses ?? null)),
  };
}

/** The layout's own options from the package's defaults, when the view has none yet. */
function fillLayout(view: View, properties: readonly Property[]): void {
  const fresh = defaultView(view.layout, properties);
  if (view.layout === 'board' && view.grouping === null) view.grouping = fresh.grouping;
  if (view.layout !== 'board') view.subGrouping = null;
  if (fresh.table && !view.table) view.table = fresh.table;
  if (fresh.board && !view.board) view.board = fresh.board;
  if (fresh.gallery && !view.gallery) view.gallery = fresh.gallery;
  if (fresh.calendar && !view.calendar) view.calendar = fresh.calendar;
  if (fresh.timeline && !view.timeline) view.timeline = fresh.timeline;
  if (fresh.chart && !view.chart) view.chart = fresh.chart;
  if (fresh.feed && !view.feed) view.feed = fresh.feed;
}

/** The changed settings of a view, checked against the database's properties. */
function checkView(current: DatabaseRecord, before: View, view: View, patch: ViewPatch): void {
  const properties = current.properties;
  const prop = (id: Id | null | undefined): Property | undefined =>
    id ? findProperty(properties, id) : undefined;
  const fail = (problem: string | null): void => {
    if (problem) throw invalid(problem);
  };
  const fits = (p: Property | undefined, aggregate: Aggregate): boolean =>
    p !== undefined && (aggregate === 'none' || aggregatesFor(p).includes(aggregate));
  const isDate = (id: Id | null): boolean =>
    id === null || DATE_TYPES.has(prop(id)?.config.type ?? '');
  const changed = (key: keyof View): boolean => key in patch || before.layout !== view.layout;

  if ('filter' in patch) fail(validateFilter(view.filter, properties));
  if ('sorts' in patch) {
    for (const sort of view.sorts) {
      const p = prop(sort.propertyId);
      if (!p || !canSortBy(p)) throw invalid(VIEW_MESSAGES.sort);
    }
  }
  for (const grouping of [view.grouping, view.subGrouping]) {
    if (!grouping || !(changed('grouping') || changed('subGrouping'))) continue;
    const p = prop(grouping.propertyId);
    if (!p || !canGroupBy(p)) throw invalid(VIEW_MESSAGES.group);
  }
  if ('calculations' in patch) {
    for (const [id, aggregate] of Object.entries(view.calculations)) {
      const p = prop(id);
      if (aggregate && p && !fits(p, aggregate)) throw invalid(VIEW_MESSAGES.calculation);
    }
  }
  if ('colorRules' in patch) fail(validateColorRules(view.colorRules, properties));
  if (view.chart && changed('chart')) fail(validateChartOptions(view.chart, properties));
  if (view.calendar && changed('calendar') && !isDate(view.calendar.showBy)) {
    throw invalid(VIEW_MESSAGES.date);
  }
  if (view.timeline && changed('timeline')) {
    if (!isDate(view.timeline.showBy) || !isDate(view.timeline.endBy)) {
      throw invalid(VIEW_MESSAGES.date);
    }
  }
  for (const preview of [view.board?.cardPreview, view.gallery?.cardPreview]) {
    if (preview?.kind !== 'files' || !(changed('board') || changed('gallery'))) continue;
    if (prop(preview.propertyId)?.config.type !== 'files') throw invalid(VIEW_MESSAGES.files);
  }
  const header = view.board?.headerCalculation;
  if (header && changed('board') && header.propertyId !== null) {
    if (!fits(prop(header.propertyId), header.aggregate)) throw invalid(VIEW_MESSAGES.calculation);
  }
  if ('form' in patch) {
    if (!view.form || view.layout !== 'form') throw invalidRequest();
    fail(validateFormDefinition(view.form, properties));
  }
  if ('dashboard' in patch) {
    // Widgets move and resize here; tiles are added and deleted as views.
    const tiles = new Set(current.views.filter((v) => v.dashboardId === view.id).map((v) => v.id));
    const widgets = view.dashboard?.widgets ?? [];
    const listed = new Set(widgets.map((w) => w.viewId));
    if (view.layout !== 'dashboard' || listed.size !== widgets.length) throw invalidRequest();
    if (listed.size !== tiles.size || [...listed].some((id) => !tiles.has(id))) {
      throw invalidRequest();
    }
  }
  if ('defaultTemplateId' in patch && typeof view.defaultTemplateId === 'string') {
    const id = view.defaultTemplateId;
    if (!current.templates.some((t) => t.id === id)) throw invalidRequest();
  }
}

export interface DeleteViewPlan {
  view: View;
  /** The view and, for a dashboard, its tiles. */
  removedIds: Id[];
  views: View[];
}

/** Deleting a view (and a dashboard's tiles); never the last view people can pick. */
export function planDeleteView(current: DatabaseRecord, viewId: Id): DeleteViewPlan {
  const view = findView(current.views, viewId);
  const removed = new Set([view.id]);
  if (view.layout === 'dashboard') {
    for (const v of current.views) if (v.dashboardId === view.id) removed.add(v.id);
  }
  const left = current.views.filter((v) => !removed.has(v.id));
  if (view.dashboardId === undefined && viewTabs(left).length === 0) {
    throw invalid(VIEW_MESSAGES.lastView);
  }
  const views = left.map((v) =>
    v.id === view.dashboardId && v.dashboard
      ? { ...v, dashboard: { widgets: v.dashboard.widgets.filter((w) => w.viewId !== view.id) } }
      : v,
  );
  return { view, removedIds: [...removed], views };
}

export interface DuplicateViewPlan {
  source: View;
  view: View;
  /** The views with the copy (and a dashboard's copied tiles) right after the source. */
  views: View[];
}

/**
 * Duplicating a view with every setting, named "Board 2" and so on, right after it. A dashboard's
 * tiles are copied too; a tile's copy joins the same dashboard. A form's copy gets `linkCode` and
 * notifies no one until people ask.
 */
export function planDuplicateView(
  current: DatabaseRecord,
  viewId: Id,
  linkCode?: string,
): DuplicateViewPlan {
  const source = findView(current.views, viewId);
  const tiles =
    source.layout === 'dashboard' ? current.views.filter((v) => v.dashboardId === source.id) : [];
  if (current.views.length + 1 + tiles.length > LIMITS.views) throw invalid(VIEW_MESSAGES.tooMany);
  const copy: View = {
    ...structuredClone(source),
    id: newId(),
    name: uniqueViewName(
      source.name,
      current.views.map((v) => v.name),
    ),
  };
  if (copy.form) {
    copy.form = { ...copy.form, linkCode: linkCode ?? '', linkChangedAt: null, notifyUserIds: [] };
  }
  let views = [...current.views];
  const copies: View[] = [];
  if (copy.dashboard) {
    const ids = new Map<Id, Id>();
    for (const tile of tiles) {
      const id = newId();
      ids.set(tile.id, id);
      copies.push({ ...structuredClone(tile), id, dashboardId: copy.id });
    }
    copy.dashboard = {
      widgets: copy.dashboard.widgets.flatMap((w) => {
        const id = ids.get(w.viewId);
        return id ? [{ ...w, id: newId(), viewId: id }] : [];
      }),
    };
  }
  const dashboard = source.dashboardId
    ? current.views.find((v) => v.id === source.dashboardId)
    : undefined;
  if (dashboard?.dashboard) {
    const widgets = dashboard.dashboard.widgets;
    if (widgets.length >= LIMITS.dashboardWidgets) throw invalid(VIEW_MESSAGES.tooManyWidgets);
    const at = widgets.findIndex((w) => w.viewId === source.id);
    const original = widgets[at];
    const widget = {
      id: newId(),
      viewId: copy.id,
      width: original?.width ?? 2,
      height: original?.height ?? 'm',
    };
    const list = [...widgets];
    list.splice(at < 0 ? list.length : at + 1, 0, widget);
    views = withDashboard(views, { ...dashboard, dashboard: { widgets: list } });
  }
  const at = views.findIndex((v) => v.id === source.id);
  views.splice(at + 1, 0, copy, ...copies);
  return { source, view: copy, views };
}

/** The views in the order of the tabs (`viewIds` lists each of them once); tiles stay after. */
export function planViewOrder(current: DatabaseRecord, viewIds: readonly Id[]): View[] {
  const tabs = viewTabs(current.views);
  const byId = new Map(tabs.map((v) => [v.id, v]));
  if (viewIds.length !== tabs.length || new Set(viewIds).size !== viewIds.length) {
    throw invalidRequest();
  }
  const ordered = viewIds.map((id) => byId.get(id));
  if (ordered.some((v) => v === undefined)) throw invalidRequest();
  return [
    ...ordered.filter((v): v is View => v !== undefined),
    ...current.views.filter((v) => v.dashboardId !== undefined),
  ];
}
