/** Schemas for views: shown properties, layout options, color rules, the whole view and overrides. */
import { z } from 'zod';
import { AGGREGATES, LIMITS, OPTION_COLORS, VIEW_LAYOUTS } from '../types';
import type {
  BoardOptions,
  CalendarOptions,
  CardPreview,
  ChartOptions,
  ColorRule,
  DashboardOptions,
  DashboardWidget,
  FeedOptions,
  GalleryOptions,
  TableOptions,
  TimelineOptions,
  View,
  ViewOverride,
  ViewPropertySetting,
} from '../types';
import {
  REQUEST_LIMITS,
  idListSchema,
  idSchema,
  isUniqueBy,
  lineSchema,
  nameSchema,
} from './common';
import { filterGroupSchema, groupingSchema, sortsSchema } from './filters';
import { formDefinitionSchema } from './forms';

/** How a view shows one property: shown or hidden, a width of 80 to 800, wrapped or not. */
export const viewPropertySettingSchema = z.strictObject({
  propertyId: idSchema,
  visible: z.boolean(),
  width: z.number().min(LIMITS.columnWidthMin).max(LIMITS.columnWidthMax).exactOptional(),
  wrap: z.boolean().exactOptional(),
}) satisfies z.ZodType<ViewPropertySetting>;

/** The properties a view lists: up to 200, each once. */
export const viewPropertiesSchema = z
  .array(viewPropertySettingSchema)
  .max(LIMITS.properties)
  .refine((list) => isUniqueBy(list, (p) => p.propertyId), 'Each property once.');

/** What a card shows at the top: nothing, the cover, the page content or a Files property. */
export const cardPreviewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('cover') }),
  z.strictObject({ kind: z.literal('content') }),
  z.strictObject({ kind: z.literal('files'), propertyId: idSchema }),
]) satisfies z.ZodType<CardPreview>;

const cardSize = z.enum(['s', 'm', 'l']);

/** Table options: frozen columns, wrapped cells and vertical lines. */
export const tableOptionsSchema = z.strictObject({
  frozenUpTo: idSchema.nullable(),
  wrapCells: z.boolean(),
  showVerticalLines: z.boolean(),
}) satisfies z.ZodType<TableOptions>;

/** Board options. The column calculation can't be "show original" or "show unique". */
export const boardOptionsSchema = z.strictObject({
  cardPreview: cardPreviewSchema,
  cardSize,
  fitImage: z.boolean(),
  colorColumns: z.boolean(),
  headerCalculation: z
    .strictObject({
      propertyId: idSchema.nullable(),
      aggregate: z.enum(AGGREGATES).exclude(['show_original', 'show_unique']),
    })
    .exactOptional(),
}) satisfies z.ZodType<BoardOptions>;

/** Gallery options: card preview, size and image fit. */
export const galleryOptionsSchema = z.strictObject({
  cardPreview: cardPreviewSchema,
  cardSize,
  fitImage: z.boolean(),
}) satisfies z.ZodType<GalleryOptions>;

/** Calendar options: the date property, month or week, and weekends. */
export const calendarOptionsSchema = z.strictObject({
  showBy: idSchema.nullable(),
  mode: z.enum(['month', 'week']),
  showWeekends: z.boolean(),
}) satisfies z.ZodType<CalendarOptions>;

/** Timeline options: start and end properties, scale, and the table beside it. */
export const timelineOptionsSchema = z.strictObject({
  showBy: idSchema.nullable(),
  endBy: idSchema.nullable(),
  scale: z.enum(['hours', 'day', 'week', 'bi_week', 'month', 'quarter', 'year']),
  showTable: z.boolean(),
  tableProperties: viewPropertiesSchema,
  showWeekends: z.boolean().exactOptional(),
  barPropertyIds: idListSchema(LIMITS.properties).exactOptional(),
  showDependencies: z.boolean().exactOptional(),
}) satisfies z.ZodType<TimelineOptions>;

/**
 * Chart options. Anything but a count needs a property to add up; an axis range needs its minimum
 * below its maximum when both are set; a reference line label is up to 100 characters.
 */
export const chartOptionsSchema = z.strictObject({
  kind: z.enum(['bar', 'horizontal_bar', 'line', 'pie', 'donut']),
  xPropertyId: idSchema.nullable(),
  xDateBucket: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  value: z
    .strictObject({
      aggregate: z.enum(['count', 'sum', 'average', 'median', 'min', 'max']),
      propertyId: idSchema.nullable(),
    })
    .refine((v) => v.aggregate === 'count' || v.propertyId !== null, 'Pick a property.'),
  splitBy: idSchema.nullable(),
  order: z.enum(['option', 'date', 'alphabetical', 'value_asc', 'value_desc']),
  showValues: z.boolean(),
  showLegend: z.boolean(),
  hideEmpty: z.boolean(),
  stacked: z.boolean(),
  cumulative: z.boolean(),
  height: z.enum(['s', 'm', 'l', 'xl']),
  grouped: z.boolean().exactOptional(),
  smooth: z.boolean().exactOptional(),
  dataLabels: z.boolean().exactOptional(),
  axisRange: z
    .strictObject({ min: z.number().nullable(), max: z.number().nullable() })
    .refine((r) => r.min === null || r.max === null || r.min < r.max, 'Min must be below max.')
    .exactOptional(),
  referenceLine: z
    .strictObject({ value: z.number(), label: lineSchema(REQUEST_LIMITS.label) })
    .nullable()
    .exactOptional(),
  palette: z.enum(['default', 'colorful', 'colorblind', 'mono']).exactOptional(),
  centerValue: z.boolean().exactOptional(),
}) satisfies z.ZodType<ChartOptions>;

/** Feed options: page content and comments. */
export const feedOptionsSchema = z.strictObject({
  showContent: z.boolean(),
  showComments: z.boolean(),
}) satisfies z.ZodType<FeedOptions>;

/** One dashboard widget: another view, 1 to 4 columns wide. */
export const dashboardWidgetSchema = z.strictObject({
  id: idSchema,
  viewId: idSchema,
  width: z.literal([1, 2, 3, 4]),
  height: z.enum(['s', 'm', 'l']),
}) satisfies z.ZodType<DashboardWidget>;

/** Dashboard options: up to 12 widgets, each id once. */
export const dashboardOptionsSchema = z.strictObject({
  widgets: z
    .array(dashboardWidgetSchema)
    .max(LIMITS.dashboardWidgets)
    .refine((list) => isUniqueBy(list, (w) => w.id), 'Each widget once.'),
}) satisfies z.ZodType<DashboardOptions>;

/** A color rule: rows (or one property) matching the filter get one of the 10 option colors. */
export const colorRuleSchema = z.strictObject({
  id: idSchema,
  filter: filterGroupSchema,
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('row') }),
    z.strictObject({ kind: z.literal('property'), propertyId: idSchema }),
  ]),
  color: z.enum(OPTION_COLORS),
}) satisfies z.ZodType<ColorRule>;

/** A view's color rules: up to 10, each id once. */
export const colorRulesSchema = z
  .array(colorRuleSchema)
  .max(LIMITS.colorRules)
  .refine((list) => isUniqueBy(list, (r) => r.id), 'Each rule once.');

/** Column calculations by property id: up to 200, none of the rollup-only "show" ones. */
export const calculationsSchema = z
  .record(idSchema, z.enum(AGGREGATES).exclude(['show_original', 'show_unique']))
  .refine((c) => Object.keys(c).length <= LIMITS.properties, 'Up to 200 calculations.');

/**
 * A whole view as a request saves it: a name of 1 to 100 characters, filter, sorts, grouping, the
 * properties it shows, manual order (up to 50,000 rows), a load limit of 10, 25, 50, 100 or 200,
 * and its layout's options. A dashboard can't show itself.
 */
export const viewSchema = z
  .strictObject({
    id: idSchema,
    name: nameSchema,
    layout: z.enum(VIEW_LAYOUTS),
    filter: filterGroupSchema.nullable(),
    sorts: sortsSchema,
    grouping: groupingSchema.nullable(),
    subGrouping: groupingSchema.nullable(),
    properties: viewPropertiesSchema,
    manualOrder: idListSchema(LIMITS.rows),
    openPagesIn: z.enum(['side_peek', 'center_peek', 'full_page']),
    showPageIcon: z.boolean(),
    loadLimit: z.literal([10, 25, 50, 100, 200]),
    calculations: calculationsSchema,
    defaultTemplateId: idSchema.nullable().exactOptional(),
    table: tableOptionsSchema.exactOptional(),
    board: boardOptionsSchema.exactOptional(),
    gallery: galleryOptionsSchema.exactOptional(),
    calendar: calendarOptionsSchema.exactOptional(),
    timeline: timelineOptionsSchema.exactOptional(),
    chart: chartOptionsSchema.exactOptional(),
    form: formDefinitionSchema.exactOptional(),
    feed: feedOptionsSchema.exactOptional(),
    dashboard: dashboardOptionsSchema.exactOptional(),
    dashboardId: idSchema.exactOptional(),
    colorRules: colorRulesSchema.exactOptional(),
    subItems: z.enum(['nested', 'flattened', 'parents_only']).exactOptional(),
    filterSubItems: z.boolean().exactOptional(),
    showTitle: z.boolean().exactOptional(),
    wrapText: z.boolean().exactOptional(),
    tabsAs: z.enum(['tabs', 'dropdown']).exactOptional(),
  })
  .refine(
    (v) => !v.dashboard?.widgets.some((w) => w.viewId === v.id),
    "A dashboard can't show itself.",
  ) satisfies z.ZodType<View>;

/** What someone without Can edit changed in a view for themselves: filter, sorts, grouping. */
export const viewOverrideSchema = z.strictObject({
  filter: filterGroupSchema.nullable().exactOptional(),
  sorts: sortsSchema.exactOptional(),
  grouping: groupingSchema.nullable().exactOptional(),
}) satisfies z.ZodType<ViewOverride>;
