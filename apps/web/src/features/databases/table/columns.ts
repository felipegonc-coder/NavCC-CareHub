import { LIMITS, type Id, type Property, type TableOptions, type View } from '@carehub/databases';

/** Default widths of a column without a saved width. */
export const NAME_WIDTH = 280;
export const COLUMN_WIDTH = 200;

/** A column of the table, in display order. */
export interface TableColumn {
  property: Property;
  /** px, 80 to 800. */
  width: number;
  /** Long values wrap onto more lines instead of being cut off. */
  wrap: boolean;
  /** Stays in place when scrolling sideways ("Freeze up to here"). */
  frozen: boolean;
  /** Distance from the table's left edge, px. */
  left: number;
}

const DEFAULT_OPTIONS: TableOptions = {
  frozenUpTo: null,
  wrapCells: false,
  showVerticalLines: true,
};

/** The view's table settings, or the defaults when it has none yet. */
export function tableOptions(view: View): TableOptions {
  return view.table ?? DEFAULT_OPTIONS;
}

/** A width kept between 80 and 800 px. */
export function clampWidth(width: number): number {
  return Math.min(LIMITS.columnWidthMax, Math.max(LIMITS.columnWidthMin, Math.round(width)));
}

/**
 * The table's columns: Name first, then the view's visible properties in its order, leaving out
 * properties the viewer can't see (`visibleIds`, from the query answer) and ones that are gone.
 * Properties the view doesn't list are hidden. `widths` overrides saved widths (while resizing);
 * `start` is where the first column begins (after the selection column), px.
 */
export function tableColumns(
  properties: readonly Property[],
  view: View,
  visibleIds: readonly Id[],
  widths: Readonly<Partial<Record<Id, number>>> = {},
  start = 0,
): TableColumn[] {
  const options = tableOptions(view);
  const canSee = new Set(visibleIds);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const settings = new Map(view.properties.map((s) => [s.propertyId, s]));
  const name = properties.find((p) => p.config.type === 'title');
  const picked: Property[] = name ? [name] : [];
  const seen = new Set(picked.map((p) => p.id));
  for (const setting of view.properties) {
    const property = byId.get(setting.propertyId);
    if (!property || seen.has(property.id) || !setting.visible || !canSee.has(property.id))
      continue;
    seen.add(property.id);
    picked.push(property);
  }
  const frozenAt =
    options.frozenUpTo === null ? -1 : picked.findIndex((p) => p.id === options.frozenUpTo);
  let left = start;
  return picked.map((property, index) => {
    const setting = settings.get(property.id);
    const fallback = property.config.type === 'title' ? NAME_WIDTH : COLUMN_WIDTH;
    const width = clampWidth(widths[property.id] ?? setting?.width ?? fallback);
    const column: TableColumn = {
      property,
      width,
      wrap: setting?.wrap ?? options.wrapCells,
      frozen: index <= frozenAt,
      left,
    };
    left += width;
    return column;
  });
}

/**
 * Every property the viewer can see, in the view's order: Name, the ones the view lists, then the
 * rest. The Properties menu lists them to show or hide.
 */
export function propertyOrder(
  properties: readonly Property[],
  view: View,
  visibleIds: readonly Id[],
): Property[] {
  const canSee = new Set(visibleIds);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const name = properties.find((p) => p.config.type === 'title');
  const out: Property[] = name ? [name] : [];
  const seen = new Set(out.map((p) => p.id));
  const add = (property: Property | undefined) => {
    if (!property || seen.has(property.id) || !canSee.has(property.id)) return;
    seen.add(property.id);
    out.push(property);
  };
  for (const setting of view.properties) add(byId.get(setting.propertyId));
  for (const property of properties) add(property);
  return out;
}

/**
 * Where a column dragged to `x` (px from the table's left edge) lands: before the first column
 * whose middle is right of it, or at the end (null). Name stays first.
 */
export function dropTarget(columns: readonly TableColumn[], x: number): Id | null {
  for (const column of columns) {
    if (column.property.config.type === 'title') continue;
    if (x < column.left + column.width / 2) return column.property.id;
  }
  return null;
}
