// The steps a press leaves to the page (`pageSteps`): Insert blocks puts blocks next to the
// button, Open a page and Open a link open them. The server has already checked them (Can edit,
// locked page, safe links) and filled in the variables.
import type { Editor, JSONContent } from '@carehub/editor';
import type { PageStep } from '@carehub/extras/templates/buttons';

/** Takes out what one step put in; false when it was changed since, so it stays. */
export type UndoStep = () => boolean;

export interface PageStepDeps {
  /** Puts the blocks above or below the button; null when it couldn't. */
  insertBlocks(where: 'above' | 'below', blocks: JSONContent[]): UndoStep | null;
  openPage(pageId: string, openIn: 'this_tab' | 'new_tab'): void;
  openLink(url: string): void;
}

export interface PageStepsResult {
  /** The step that couldn't be done (1-based) and why; later steps didn't run. */
  failure: { step: number; message: string } | null;
  /** How to take out what was inserted, newest first. */
  undo: UndoStep[];
  /** Whether blocks were inserted. */
  changed: boolean;
}

export const NOT_ON_PAGE = "The button isn't on this page anymore.";

/**
 * Does the steps in order. Opening a page in this tab waits for the others, since it leaves the
 * page; only the last one opens.
 */
export function doPageSteps(steps: readonly PageStep[], deps: PageStepDeps): PageStepsResult {
  const undo: UndoStep[] = [];
  let failure: PageStepsResult['failure'] = null;
  let openHere: string | null = null;
  for (const step of steps) {
    if (step.kind === 'insert_blocks') {
      if (step.blocks.length === 0) continue;
      const remove = deps.insertBlocks(step.where, step.blocks as JSONContent[]);
      if (!remove) {
        failure = { step: step.index + 1, message: NOT_ON_PAGE };
        break;
      }
      undo.unshift(remove);
    } else if (step.kind === 'open_link') {
      deps.openLink(step.url);
    } else if (step.openIn === 'new_tab') {
      deps.openPage(step.pageId, 'new_tab');
    } else {
      openHere = step.pageId;
    }
  }
  if (openHere && !failure) deps.openPage(openHere, 'this_tab');
  return { failure, undo, changed: undo.length > 0 };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Inserts blocks right above or below the button at `getPos()` (its node view's position). The
 * undo finds them next to the button again, so edits elsewhere and other people's changes don't
 * matter; it leaves them if any of them was changed or moved since.
 */
export function insertNextTo(
  editor: Editor,
  getPos: () => number | undefined,
  where: 'above' | 'below',
  blocks: JSONContent[],
): UndoStep | null {
  const find = () => {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== 'actionButton') return null;
    const $pos = editor.state.doc.resolve(pos);
    return { pos, node, $pos, index: $pos.index(), parent: $pos.parent };
  };
  const button = find();
  if (!button || blocks.length === 0) return null;
  const before = button.parent.childCount;
  const at = where === 'above' ? button.pos : button.pos + button.node.nodeSize;
  try {
    const done = editor.chain().insertContentAt(at, blocks, { updateSelection: false }).run();
    if (!done) return null;
  } catch {
    return null;
  }

  const after = find();
  if (!after) return null;
  const count = after.parent.childCount - before;
  const start = (spot: NonNullable<ReturnType<typeof find>>) =>
    where === 'above' ? spot.index - count : spot.index + 1;
  const inserted: unknown[] = [];
  for (let i = 0; i < count; i += 1) inserted.push(after.parent.child(start(after) + i).toJSON());

  return () => {
    const now = find();
    if (!now || count <= 0) return false;
    const first = start(now);
    if (first < 0 || first + count > now.parent.childCount) return false;
    for (let i = 0; i < count; i += 1) {
      if (!same(now.parent.child(first + i).toJSON(), inserted[i])) return false;
    }
    const from = now.$pos.posAtIndex(first);
    const to = now.$pos.posAtIndex(first + count);
    return editor.chain().deleteRange({ from, to }).run();
  };
}
