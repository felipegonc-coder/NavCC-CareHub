import type { DatabaseMeta, EvalContext, Id, View, Viewer } from '@carehub/databases';
import type { PersonChoice } from '../cells';
import type { ViewActions } from '../contract';

/** What the Filter and Sort panels draw from (most of it from the shell's PanelProps). */
export interface FilterPanelBaseProps {
  meta: DatabaseMeta;
  /** The view as the viewer sees it (with their "Changed for you only" override). */
  view: View;
  viewer: Viewer;
  /** Changes go through updateView: saved for everyone, or "Changed for you only". */
  actions: Pick<ViewActions, 'updateView'>;
  /** The properties the viewer can see (the query answer's propertyIds); all when absent. */
  propertyIds?: readonly Id[] | undefined;
  /** People to pick in Person rules, besides "Me". */
  people?: readonly PersonChoice[] | undefined;
  /** Titles of related rows (the query answer's rowTitles), for Relation rules. */
  rowTitles?: Readonly<Record<Id, string>> | undefined;
}

/** Where a filter chip opens the Filter panel: on its rule, or on the advanced filter. */
export interface FilterTarget {
  ruleId?: Id | undefined;
  advanced?: boolean | undefined;
}

/**
 * What the panels use when the shell passes it besides PanelProps: the query answer's
 * propertyIds and rowTitles, and the chip that opened the Filter panel.
 */
export interface PanelExtras {
  propertyIds?: readonly Id[] | undefined;
  rowTitles?: Readonly<Record<Id, string>> | undefined;
  target?: FilterTarget | undefined;
}

/** Names for people and related rows in filter chips and rules. */
export function panelContext({
  meta,
  viewer,
  people = [],
  rowTitles = {},
}: Pick<FilterPanelBaseProps, 'meta' | 'viewer' | 'people' | 'rowTitles'>): EvalContext {
  return {
    properties: meta.properties,
    viewer,
    userName: (id) => people.find((p) => p.id === id)?.name,
    rowTitle: (id) => rowTitles[id],
  };
}
