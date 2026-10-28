import { Extension, getSplittedAttributes, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BLOCK_ID, blockIdOf, newBlockId } from './block-ids';
import { toggleOfTitle } from './blocks/toggle';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleState: {
      /** Opens or closes the toggle at `pos`, or the one whose title holds the cursor. */
      flipToggle: (pos?: number) => ReturnType;
      /** Opens every toggle on the page, or closes them all if they're all open. */
      flipAllToggles: () => ReturnType;
    };
  }
}

interface ToggleStateValue {
  open: ReadonlySet<string>;
  decorations: DecorationSet;
}

/** A transaction's meta when it opens or closes toggles. */
interface Flip {
  ids: string[];
  open: boolean;
}

interface FoundToggle {
  node: ProseMirrorNode;
  pos: number;
}

const toggleStateKey = new PluginKey<ToggleStateValue>('toggleState');

const titleId = (toggle: ProseMirrorNode) =>
  toggle.firstChild ? blockIdOf(toggle.firstChild) : null;

/** True if you have this toggle open. */
export function isToggleOpen(state: EditorState, toggle: ProseMirrorNode): boolean {
  const id = titleId(toggle);
  return id !== null && (toggleStateKey.getState(state)?.open.has(id) ?? false);
}

/**
 * Open toggles are marked for their view (`spec.toggleOpen`); the blocks in a closed toggle get
 * `.ch-toggle-hidden`, all but its title.
 */
function decorate(doc: ProseMirrorNode, open: ReadonlySet<string>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'toggle') return !node.isTextblock;
    const id = titleId(node);
    if (id !== null && open.has(id)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { toggleOpen: true }));
      return true;
    }
    node.forEach((child, offset, index) => {
      const from = pos + 1 + offset;
      if (index > 0) {
        decorations.push(
          Decoration.node(from, from + child.nodeSize, { class: 'ch-toggle-hidden' }),
        );
      }
    });
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** The closed toggles that hide `pos` in `doc` (it's past their title), outermost first. */
function hidingToggles(state: EditorState, doc: ProseMirrorNode, pos: number): FoundToggle[] {
  const $pos = doc.resolve(pos);
  const found: FoundToggle[] = [];
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'toggle' && $pos.index(depth) > 0 && !isToggleOpen(state, node)) {
      found.push({ node, pos: $pos.before(depth) });
    }
  }
  return found;
}

/** Adds to `tr` the opening or closing of `toggles`. A title with no ID gets one if `editable`. */
function setOpen(tr: Transaction, toggles: FoundToggle[], open: boolean, editable: boolean) {
  const ids: string[] = [];
  for (const { node, pos } of toggles) {
    let id = titleId(node);
    if (id === null && editable) {
      id = newBlockId();
      tr.setNodeAttribute(pos + 1, BLOCK_ID, id).setMeta('addToHistory', false);
    }
    if (id !== null) ids.push(id);
  }
  if (ids.length > 0) tr.setMeta(toggleStateKey, { ids, open } satisfies Flip);
  return ids.length > 0;
}

/** Opens the closed toggles around `pos`, so the block there shows (links to a block). */
export function openTogglesAround(editor: Editor, tr: Transaction, pos: number) {
  const toggles = hidingToggles(editor.state, tr.doc, pos);
  if (toggles.length > 0) setOpen(tr, toggles, true, editor.isEditable);
}

/**
 * Enter in the title of a closed toggle: the text after the cursor goes to a new toggle below, and
 * the blocks inside stay hidden in this one.
 */
function splitClosedToggle(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, $to, empty } = state.selection;
  const pos = toggleOfTitle($from);
  const toggle = pos === null ? null : state.doc.nodeAt(pos);
  if (pos === null || !toggle || !$to.sameParent($from) || isToggleOpen(state, toggle))
    return false;
  const title = $from.parent;
  // Toggle's own keys: an empty toggle turns back into a line, Enter at the start adds one above.
  if (empty && (title.content.size === 0 ? toggle.childCount === 1 : $from.parentOffset === 0)) {
    return false;
  }
  const { tr } = state;
  tr.deleteSelection();
  const $cut = tr.selection.$from;
  const rest = $cut.parent.content.cut($cut.parentOffset);
  tr.delete($cut.pos, $cut.end());
  const attrs = getSplittedAttributes(
    editor.extensionManager.attributes,
    title.type.name,
    title.attrs,
  );
  const below = toggle.type.create(toggle.attrs, title.type.create(attrs, rest));
  const at = tr.mapping.map(pos + toggle.nodeSize);
  tr.insert(at, below);
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Backspace at the start of the line under a closed toggle joins the line to the toggle's title,
 * the line above on screen, rather than to the last hidden block.
 */
function joinUnderClosedToggle(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0 || $from.depth < 1 || $from.parent.type.spec.code) {
    return false;
  }
  const index = $from.index(-1);
  const above = index > 0 ? $from.node(-1).child(index - 1) : null;
  const title = above?.firstChild;
  if (!above || !title || above.type.name !== 'toggle' || isToggleOpen(state, above)) return false;
  const line = $from.before();
  const titleEnd = line - above.nodeSize + title.nodeSize;
  const { tr } = state;
  tr.delete(line, line + $from.parent.nodeSize).insert(titleEnd, $from.parent.content);
  tr.setSelection(TextSelection.create(tr.doc, titleEnd));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Which toggles you have open (spec 3.4, PB-14): per person, so opening one never changes it for
 * anyone else, also in a read-only editor. They're kept in the editor, by the block ID of their
 * title, until the page reloads. The arrow, Ctrl/Cmd+Enter in the title and Ctrl/Cmd+Alt+T (every
 * toggle) open and close them. A closed toggle hides all but its title, and the cursor never stays
 * in hidden blocks.
 */
export const ToggleState = Extension.create({
  name: 'toggleState',

  addCommands() {
    return {
      flipToggle:
        (pos?: number) =>
        ({ state, tr, dispatch }) => {
          const at = pos ?? toggleOfTitle(state.selection.$from);
          const node = at === null ? null : state.doc.nodeAt(at);
          if (at === null || node?.type.name !== 'toggle') return false;
          const toggles = [{ node, pos: at }];
          const open = !isToggleOpen(this.editor.state, node);
          return dispatch ? setOpen(tr, toggles, open, this.editor.isEditable) : true;
        },
      flipAllToggles:
        () =>
        ({ state, tr, dispatch }) => {
          const toggles: FoundToggle[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'toggle') toggles.push({ node, pos });
            return !node.isTextblock;
          });
          if (toggles.length === 0) return false;
          const open = toggles.some(({ node }) => !isToggleOpen(this.editor.state, node));
          return dispatch ? setOpen(tr, toggles, open, this.editor.isEditable) : true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () =>
        toggleOfTitle(this.editor.state.selection.$from) !== null &&
        this.editor.commands.flipToggle(),
      'Mod-Alt-t': () => this.editor.commands.flipAllToggles(),
      Enter: () => splitClosedToggle(this.editor),
      Backspace: () => joinUnderClosedToggle(this.editor),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ToggleStateValue>({
        key: toggleStateKey,
        state: {
          init: (_config, state) => {
            const open = new Set<string>();
            return { open, decorations: decorate(state.doc, open) };
          },
          apply: (tr, value, _before, state) => {
            const flip = tr.getMeta(toggleStateKey) as Flip | undefined;
            if (!flip && !tr.docChanged) return value;
            let { open } = value;
            if (flip) {
              const next = new Set(open);
              for (const id of flip.ids) {
                if (flip.open) next.add(id);
                else next.delete(id);
              }
              open = next;
            }
            return { open, decorations: decorate(state.doc, open) };
          },
        },
        props: {
          decorations: (state) => toggleStateKey.getState(state)?.decorations ?? null,
        },
        // The cursor never stays in hidden blocks: it goes on past the toggle, or back to its title.
        appendTransaction: (transactions, before, state) => {
          const touched = transactions.some(
            (tr) => tr.docChanged || tr.selectionSet || tr.getMeta(toggleStateKey) !== undefined,
          );
          const { selection, doc } = state;
          const [hidden] = touched
            ? [
                ...hidingToggles(state, doc, selection.from),
                ...hidingToggles(state, doc, selection.to),
              ]
            : [];
          const title = hidden?.node.firstChild;
          if (!hidden || !title) return null;
          const forward = selection.head > before.selection.head;
          const $after = doc.resolve(hidden.pos + hidden.node.nodeSize);
          const next = forward ? Selection.findFrom($after, 1, true) : null;
          return state.tr.setSelection(
            next ?? TextSelection.create(doc, hidden.pos + title.nodeSize),
          );
        },
      }),
    ];
  },
});
