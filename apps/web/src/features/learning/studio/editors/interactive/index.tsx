import type { BlockEditors } from '../registry';
import { ButtonEditor } from './ButtonEditor';
import { FlashcardsEditor } from './FlashcardsEditor';
import { ProcessEditor } from './ProcessEditor';
import { AccordionEditor, TabsEditor } from './SectionsEditors';
import { SortingEditor } from './SortingEditor';
import { TimelineEditor } from './TimelineEditor';

/** Editors for accordion, tabs, timeline, process, flashcards, sorting and button blocks (B10). */
export const interactiveEditors: BlockEditors = {
  accordion: AccordionEditor,
  tabs: TabsEditor,
  timeline: TimelineEditor,
  process: ProcessEditor,
  flashcards: FlashcardsEditor,
  sorting: SortingEditor,
  button: ButtonEditor,
};
