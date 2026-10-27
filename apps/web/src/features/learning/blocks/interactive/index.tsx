import type { BlockViews } from '../registry';
import { AccordionView } from './AccordionView';
import { ButtonView } from './ButtonView';
import { FlashcardsView } from './FlashcardsView';
import { ProcessView } from './ProcessView';
import { SortingView } from './SortingView';
import { TabsView } from './TabsView';
import { TimelineView } from './TimelineView';

// Interactive block views (B10): accordion, tabs, timeline, process, flashcards, sorting and button.
// Created empty by B5 (decision 0308); B10 fills it, and blocks/registry.tsx spreads it into
// `blockViews`.
export const interactiveViews: BlockViews = {
  accordion: AccordionView,
  tabs: TabsView,
  timeline: TimelineView,
  process: ProcessView,
  flashcards: FlashcardsView,
  sorting: SortingView,
  button: ButtonView,
};
