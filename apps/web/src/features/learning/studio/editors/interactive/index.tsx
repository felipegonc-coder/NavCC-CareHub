import type { AccordionBlock, ProcessBlock, TabsBlock, TimelineBlock } from '@carehub/learning';
import type { JSX } from 'react';
import type { EditorProps } from '../media/editor-props';
import { ProcessEditor } from './ProcessEditor';
import { AccordionEditor, TabsEditor } from './SectionsEditors';
import { TimelineEditor } from './TimelineEditor';

// Interactive block editors (B10). B8's studio/editors/registry.tsx spreads `interactiveEditors` into the editors.

/** The editors of the interactive blocks, keyed by block type (registry shape in docs/learning/PLAN.md). */
export const interactiveEditors: {
  accordion: (props: EditorProps<AccordionBlock>) => JSX.Element;
  tabs: (props: EditorProps<TabsBlock>) => JSX.Element;
  timeline: (props: EditorProps<TimelineBlock>) => JSX.Element;
  process: (props: EditorProps<ProcessBlock>) => JSX.Element;
} = {
  accordion: AccordionEditor,
  tabs: TabsEditor,
  timeline: TimelineEditor,
  process: ProcessEditor,
};
