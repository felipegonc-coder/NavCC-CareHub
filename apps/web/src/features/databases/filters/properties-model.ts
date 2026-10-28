/**
 * The Properties panel's rules (Databases spec 3.2 and 3.3): which properties a view shows, in
 * what order, and their widths and wrapping in a table. View.properties lists them; a property
 * missing there is hidden. Name always comes first: tables always show it, and other layouts hide
 * it with View.showTitle.
 */
import { LIMITS, type Id, type Property, type ViewPropertySetting } from '@carehub/databases';

export interface PropertyList {
  /** Name, which is never moved. */
  title: Property | undefined;
  /** Shown in this view, in its order. */
  shown: Property[];
  /** Hidden in this view, in the database's order. */
  hidden: Property[];
}

/** What the panel lists, leaving out properties the viewer can't see (`visibleIds`, when given). */
export function listProperties(
  properties: readonly Property[],
  settings: readonly ViewPropertySetting[],
  visibleIds?: readonly Id[],
): PropertyList {
  const canSee = visibleIds ? new Set(visibleIds) : null;
  const seen = (p: Property) => canSee === null || canSee.has(p.id);
  const title = properties.find((p) => p.config.type === 'title');
  const byId = new Map(properties.map((p) => [p.id, p]));
  const placed = new Set<Id>(title ? [title.id] : []);
  const shown: Property[] = [];
  for (const setting of settings) {
    const property = byId.get(setting.propertyId);
    if (!property || placed.has(property.id) || !setting.visible || !seen(property)) continue;
    placed.add(property.id);
    shown.push(property);
  }
  const hidden = properties.filter((p) => !placed.has(p.id) && seen(p));
  return { title: title && seen(title) ? title : undefined, shown, hidden };
}

/**
 * The view's list after a change: `shown` visible in this order, then `hidden`. Properties the
 * panel doesn't list (Name, ones the viewer can't see, ones that are gone) keep their places, and
 * every property keeps its width and wrap. A hidden property the view never listed stays out.
 */
export function arrange(
  settings: readonly ViewPropertySetting[],
  shown: readonly Id[],
  hidden: readonly Id[],
): ViewPropertySetting[] {
  const saved = new Map(settings.map((s) => [s.propertyId, s]));
  const listed = new Set([...shown, ...hidden]);
  const queue: ViewPropertySetting[] = [
    ...shown.map((id) => ({ ...(saved.get(id) ?? { propertyId: id }), visible: true })),
    ...hidden.flatMap((id) => {
      const setting = saved.get(id);
      return setting ? [{ ...setting, visible: false }] : [];
    }),
  ];
  const out: ViewPropertySetting[] = [];
  let next = 0;
  for (const setting of settings) {
    if (!listed.has(setting.propertyId)) {
      out.push(setting);
      continue;
    }
    const placed = queue[next];
    next += 1;
    if (placed) out.push(placed);
  }
  return [...out, ...queue.slice(next)];
}

const ids = (properties: readonly Property[]) => properties.map((p) => p.id);

/** Shows a property (at the end of the shown ones) or hides it. */
export function withShown(
  list: PropertyList,
  settings: readonly ViewPropertySetting[],
  propertyId: Id,
  show: boolean,
): ViewPropertySetting[] {
  const shown = ids(list.shown).filter((id) => id !== propertyId);
  const hidden = ids(list.hidden).filter((id) => id !== propertyId);
  return show
    ? arrange(settings, [...shown, propertyId], hidden)
    : arrange(settings, shown, [propertyId, ...hidden]);
}

/** "Show all" and "Hide all" (Name aside). */
export function withAllShown(
  list: PropertyList,
  settings: readonly ViewPropertySetting[],
  show: boolean,
): ViewPropertySetting[] {
  const all = [...ids(list.shown), ...ids(list.hidden)];
  return show ? arrange(settings, all, []) : arrange(settings, [], all);
}

/** Moves a shown property from one place to another. */
export function withMoved(
  list: PropertyList,
  settings: readonly ViewPropertySetting[],
  from: number,
  to: number,
): ViewPropertySetting[] {
  const shown = ids(list.shown);
  const [moved] = shown.splice(from, 1);
  if (moved === undefined) return [...settings];
  shown.splice(to, 0, moved);
  return arrange(settings, shown, ids(list.hidden));
}

/** A column's width (undefined: the table's default) or wrap, Name's included. */
export function withColumn(
  settings: readonly ViewPropertySetting[],
  propertyId: Id,
  change: { width?: number | undefined; wrap?: boolean },
): ViewPropertySetting[] {
  const apply = (setting: ViewPropertySetting): ViewPropertySetting => {
    const next: ViewPropertySetting = { ...setting };
    if ('width' in change) {
      if (change.width === undefined) delete next.width;
      else next.width = change.width;
    }
    if (change.wrap !== undefined) next.wrap = change.wrap;
    return next;
  };
  const at = settings.findIndex((s) => s.propertyId === propertyId);
  if (at < 0) return [...settings, apply({ propertyId, visible: true })];
  return settings.map((s, i) => (i === at ? apply(s) : s));
}

/** A typed width: whole px from 80 to 800; undefined when empty (the default); null otherwise. */
export function readWidth(text: string): number | undefined | null {
  const typed = text.trim();
  if (typed === '') return undefined;
  if (!/^\d+$/.test(typed)) return null;
  const width = Number(typed);
  return width >= LIMITS.columnWidthMin && width <= LIMITS.columnWidthMax ? width : null;
}

/** The properties whose name has `query` in it, ignoring case. */
export function matching(properties: readonly Property[], query: string): Property[] {
  const q = query.trim().toLocaleLowerCase();
  return q ? properties.filter((p) => p.name.toLocaleLowerCase().includes(q)) : [...properties];
}
