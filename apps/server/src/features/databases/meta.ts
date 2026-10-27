// DatabaseMeta as one person may see it (decision 0200, "Who can do what"): their level, only the
// properties they can see (formulas and rollups that read hidden ones are hidden too, across
// relations), views and templates without hidden properties, row access rules for Full access only,
// form links for people who can edit, and no titles of mentioned pages they can't open. Pure, so
// GET /:id and every settings write answer the same way.
import type {
  CardPreview,
  DatabaseGrant,
  DatabaseMeta,
  FilterGroup,
  FilterNode,
  Id,
  Property,
  RowTemplate,
  View,
} from '@carehub/databases';
import {
  atLeast,
  canSeeProperty,
  databasePageAccess,
  type PropertyViewer,
} from '@carehub/databases/access';
import { visiblePropertyIds } from '@carehub/databases/engine';
import { formulaDependencies } from '@carehub/databases/formula';
import { liveDeleted } from './properties';
import { iconText, type DatabaseRecord } from './record';

/** A deleted property people who can edit may restore (Properties → Deleted), without values. */
export type DeletedPropertyInfo = { property: Property; deletedAt: string };

/**
 * What GET /:id and every settings write answer: DatabaseMeta and the version to send back; for
 * people who can edit, also the properties deleted in the last 30 days.
 */
export type DatabaseAnswer = DatabaseMeta & {
  version: number;
  /** A Knowledge base wiki (until the package's DatabaseMeta has it). */
  wiki: boolean;
  deletedProperties?: DeletedPropertyInfo[];
};

export interface MetaInput {
  record: DatabaseRecord;
  /** The person's level on the database page. */
  access: DatabaseGrant;
  viewer: PropertyViewer;
  /** Properties of the databases this one relates to, and of theirs, by id (loadRelatedProperties). */
  related?: ReadonlyMap<Id, Property>;
  /** The pages mentioned in the description and templates that the person can open. */
  openablePages?: ReadonlySet<string>;
  /** For the 30 days deleted properties are kept. */
  now?: Date;
}

/**
 * The ids of the database's properties this person can see: canSeeProperty for each property,
 * here and in related databases, and the engine's rule for formulas and rollups that read them.
 */
export function visibleIds(
  properties: readonly Property[],
  viewer: PropertyViewer,
  related: ReadonlyMap<Id, Property> = new Map(),
): Set<Id> {
  const byId = new Map<Id, Property>(related);
  for (const p of properties) byId.set(p.id, p);
  // A property that no longer exists has nothing to give away.
  const canSee = (id: Id) => {
    const p = byId.get(id);
    return !p || canSeeProperty(p, viewer);
  };
  const dependsOn = (id: Id): Id[] => {
    const config = byId.get(id)?.config;
    if (config?.type === 'rollup') return [config.relationPropertyId, config.targetPropertyId];
    if (config?.type !== 'formula') return [];
    const reads = formulaDependencies(config.expression);
    return [...reads.local, ...reads.related.flatMap((r) => [r.relationPropertyId, r.propertyId])];
  };
  return visiblePropertyIds(properties, canSee, dependsOn);
}

function pruneFilter(group: FilterGroup | null, hidden: ReadonlySet<Id>): FilterGroup | null {
  if (!group) return null;
  const children = group.children.flatMap((node): FilterNode[] => {
    if (node.kind === 'condition') return hidden.has(node.propertyId) ? [] : [node];
    const inner = pruneFilter(node, hidden);
    return inner ? [inner] : [];
  });
  return children.length > 0 ? { ...group, children } : null;
}

function usesHidden(node: FilterNode, hidden: ReadonlySet<Id>): boolean {
  return node.kind === 'condition'
    ? hidden.has(node.propertyId)
    : node.children.some((child) => usesHidden(child, hidden));
}

/**
 * A view without the properties this person can't see: no columns, filter conditions, sorts,
 * groupings, calculations, color rules, card previews or date and chart settings that use them.
 * (Their queries are blocked anyway; this keeps the hidden properties out of the settings too.)
 * A form keeps its questions (a form shows only its own); its link code is for people who can edit.
 */
export function viewForViewer(view: View, hidden: ReadonlySet<Id>, canEdit: boolean): View {
  const out: View = { ...view };
  if (view.form && !canEdit) out.form = { ...view.form, linkCode: '' };
  if (hidden.size === 0) return out;
  const shown = (id: Id | null | undefined): boolean => !id || !hidden.has(id);
  const keep = <T extends { propertyId: Id }>(list: readonly T[]): T[] =>
    list.filter((item) => shown(item.propertyId));
  const preview = (p: CardPreview): CardPreview =>
    p.kind === 'files' && !shown(p.propertyId) ? { kind: 'none' } : p;
  const orNull = (id: Id | null): Id | null => (shown(id) ? id : null);

  out.properties = keep(view.properties);
  out.filter = pruneFilter(view.filter, hidden);
  out.sorts = keep(view.sorts);
  if (!shown(view.grouping?.propertyId)) {
    out.grouping = null;
    out.subGrouping = null;
  } else if (!shown(view.subGrouping?.propertyId)) {
    out.subGrouping = null;
  }
  out.calculations = Object.fromEntries(
    Object.entries(view.calculations).filter(([id]) => shown(id)),
  );
  if (view.colorRules) {
    out.colorRules = view.colorRules.filter(
      (rule) =>
        !usesHidden(rule.filter, hidden) &&
        (rule.target.kind !== 'property' || shown(rule.target.propertyId)),
    );
  }
  if (view.board) {
    const board = { ...view.board, cardPreview: preview(view.board.cardPreview) };
    if (view.board.headerCalculation && !shown(view.board.headerCalculation.propertyId)) {
      board.headerCalculation = { propertyId: null, aggregate: 'count_all' };
    }
    out.board = board;
  }
  if (view.gallery)
    out.gallery = { ...view.gallery, cardPreview: preview(view.gallery.cardPreview) };
  if (view.calendar) out.calendar = { ...view.calendar, showBy: orNull(view.calendar.showBy) };
  if (view.timeline) {
    const timeline = {
      ...view.timeline,
      showBy: orNull(view.timeline.showBy),
      endBy: orNull(view.timeline.endBy),
      tableProperties: keep(view.timeline.tableProperties),
    };
    if (view.timeline.barPropertyIds) {
      timeline.barPropertyIds = view.timeline.barPropertyIds.filter((id) => shown(id));
    }
    out.timeline = timeline;
  }
  if (view.chart) {
    const { chart } = view;
    out.chart = {
      ...chart,
      xPropertyId: orNull(chart.xPropertyId),
      splitBy: orNull(chart.splitBy),
      value: shown(chart.value.propertyId) ? chart.value : { aggregate: 'count', propertyId: null },
    };
  }
  return out;
}

type Span = { text: string; mention?: { kind: string; id?: unknown } };

const isSpanList = (value: unknown): value is Span[] =>
  Array.isArray(value) &&
  value.every(
    (item) => item !== null && typeof item === 'object' && typeof (item as Span).text === 'string',
  );

const pageMention = (span: Span): string | null =>
  span.mention?.kind === 'page' && typeof span.mention.id === 'string' ? span.mention.id : null;

/** Rich text with the label of every mentioned page the person can't open left out. */
export function hideMentionTitles<T>(value: T, openable: ReadonlySet<string>): T {
  if (!isSpanList(value)) return value;
  let changed = false;
  const spans = value.map((span) => {
    const id = pageMention(span);
    if (id === null || openable.has(id) || span.text === '') return span;
    changed = true;
    return { ...span, text: '' };
  });
  return changed ? (spans as unknown as T) : value;
}

/** Every page mentioned in the description and in templates' rich text values. */
export function mentionedPageIds(record: Pick<DatabaseRecord, 'description' | 'templates'>) {
  const ids = new Set<string>();
  const collect = (value: unknown) => {
    if (!isSpanList(value)) return;
    for (const span of value) {
      const id = pageMention(span);
      if (id !== null) ids.add(id);
    }
  };
  collect(record.description);
  for (const template of record.templates) Object.values(template.values).forEach(collect);
  return [...ids];
}

function templateForViewer(
  template: RowTemplate,
  hidden: ReadonlySet<Id>,
  openable: ReadonlySet<string>,
): RowTemplate {
  const values = Object.fromEntries(
    Object.entries(template.values)
      .filter(([id]) => !hidden.has(id))
      .map(([id, value]) => [id, hideMentionTitles(value, openable)]),
  );
  return { ...template, values };
}

/** The database as this person may see it, with its version. */
export function databaseMeta(input: MetaInput): DatabaseAnswer {
  const { record, access, viewer } = input;
  const level = databasePageAccess(access);
  const visible = visibleIds(record.properties, viewer, input.related);
  // Hidden properties, and deleted ones (views keep pointing at them until they're restored).
  const hidden = new Set([
    ...record.properties.filter((p) => !visible.has(p.id)).map((p) => p.id),
    ...record.deletedProperties.map((d) => d.property.id),
  ]);
  const openable = input.openablePages ?? new Set<string>();
  const canEdit = atLeast(level, 'edit');
  const meta: DatabaseAnswer = {
    id: record.id,
    title: record.title,
    icon: iconText(record.pageIcon),
    description: hideMentionTitles(record.description, openable),
    inline: record.inline,
    locked: record.locked,
    wiki: record.wiki === true,
    properties: record.properties.filter((p) => visible.has(p.id)),
    views: record.views.map((view) => viewForViewer(view, hidden, canEdit)),
    accessRules: atLeast(level, 'full') ? record.accessRules : [],
    templates: record.templates.map((t) => templateForViewer(t, hidden, openable)),
    defaultTemplateId: record.defaultTemplateId,
    viewerAccess: access,
    subItems: record.subItems,
    dependencies: record.dependencies,
    version: record.version,
  };
  if (canEdit) {
    meta.deletedProperties = liveDeleted(record.deletedProperties, input.now ?? new Date())
      .filter((d) => canSeeProperty(d.property, viewer))
      .map((d) => ({ property: d.property, deletedAt: d.deletedAt }));
  }
  if (record.rowPageLayout) {
    const layout = record.rowPageLayout;
    meta.rowPageLayout = { ...layout, pinned: layout.pinned.filter((id) => !hidden.has(id)) };
  }
  return meta;
}
