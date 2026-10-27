import type { AccordionBlock, ButtonBlock, TabsBlock, TimelineBlock } from '@carehub/learning';
import type { JSX } from 'react';
import type { ViewProps } from '../media';
import { AccordionView } from './AccordionView';
import { ButtonView } from './ButtonView';
import { TabsView } from './TabsView';
import { TimelineView } from './TimelineView';

// Interactive block views (B10). B5's blocks/registry.tsx spreads `interactiveViews` into `blockViews`.

/** The views of the interactive blocks, keyed by block type (registry shape in docs/learning/PLAN.md). */
export const interactiveViews: {
  accordion: (props: ViewProps<AccordionBlock>) => JSX.Element;
  tabs: (props: ViewProps<TabsBlock>) => JSX.Element;
  timeline: (props: ViewProps<TimelineBlock>) => JSX.Element;
  button: (props: ViewProps<ButtonBlock>) => JSX.Element;
} = {
  accordion: AccordionView,
  tabs: TabsView,
  timeline: TimelineView,
  button: ButtonView,
};
