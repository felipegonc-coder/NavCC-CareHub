import type { JSX } from 'react';
import type { Block, BlockType, Course, Id } from '@carehub/learning';
import { interactiveEditors } from './interactive';
import { mediaEditors } from './media';
import { questionEditors } from './questions';
import { scenarioEditors } from './scenario';
import { textEditors } from './text';

// The Studio's block editors, one family file per owner (docs/learning/PLAN.md, "Shared web contracts"):
// text and continue (B8, text/), media and interactive (B10), knowledge_check (B9, questions/), scenario (B2).

/** What every block editor gets: the block, a way to change it, and where it lives. */
export type BlockEditorProps<B extends Block = Block> = {
  block: B;
  onChange(next: B): void;
  course: Course;
  lessonId: Id;
};

/** Block editors by block type. Each family file fills in its own types. */
export type BlockEditors = {
  [T in BlockType]?: (props: BlockEditorProps<Extract<Block, { type: T }>>) => JSX.Element;
};

/** Every block editor, from the family files. */
export const blockEditors: BlockEditors = {
  ...textEditors,
  ...mediaEditors,
  ...interactiveEditors,
  ...questionEditors,
  ...scenarioEditors,
};

/** The editor for `props.block`, or a short note while its family hasn't landed. */
export function BlockEditorFor(props: BlockEditorProps): JSX.Element {
  const Editor = blockEditors[props.block.type] as
    ((editorProps: BlockEditorProps) => JSX.Element) | undefined;
  if (Editor) return <Editor {...props} />;
  return <p className="text-small text-muted">This block can&apos;t be edited here yet.</p>;
}
