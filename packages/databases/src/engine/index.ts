/**
 * The view engine (W1c-1): answers a database view for one viewer with property and row access,
 * "Changed for you only", filter, search, sort, groups, totals and paging, and nothing they can't see.
 */
export { decodeCursor, encodeCursor, pageSize, type Cursor } from './paging';
export { countRows, runViewQuery, type GroupCount, type RowCounts } from './query';
export { hiddenMetaFields, projectRow, withoutHidden, type Projection } from './rows';
export {
  HIDDEN_ROW_ID,
  QUERY_TOO_SLOW,
  VIEW_BLOCKED,
  type ArrangedLine,
  type ComputeContext,
  type QueryBudget,
  type QueryGroup,
  type QueryLane,
  type QueryRow,
  type ViewQueryBlocked,
  type ViewQueryData,
  type ViewQueryInput,
  type ViewQueryResult,
  type ViewerAccess,
} from './shapes';
export {
  applyOverride,
  usesHiddenProperty,
  viewPropertyIds,
  visiblePropertyIds,
} from './visibility';
