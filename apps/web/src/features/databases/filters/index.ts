/**
 * The view panels: Filter and Sort. The shell's panel registry (../panels.tsx) loads
 * filter-entry.tsx and sort-entry.tsx; the toolbar's filter chips name their rules with ruleText
 * and panelContext, and open the Filter panel on a rule with a FilterTarget.
 */
export { FilterPanel, type FilterPanelProps } from './filter-panel';
export { FILTER_TEXT, PANEL_TEXT, SORT_TEXT } from './messages';
export { ruleText, valueText } from './rule-text';
export { SortPanel } from './sort-panel';
export {
  panelContext,
  type FilterPanelBaseProps,
  type FilterTarget,
  type PanelExtras,
} from './types';
