import { Extension, type Editor } from '@tiptap/core';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  blockAt,
  blocksEndingWith,
  dropPos,
  hasTitle,
  insertLine,
  isList,
  moveBlocks,
  newUndoStep,
  selectedBlocks,
  selectionIn,
  type Block,
  type Place,
} from './block-drag';
import './block-handle.css';

/** How far the pointer moves, in pixels, before a press on ⋮⋮ becomes a drag. */
const DRAG_DISTANCE = 4;
/** How far right of a line's start the pointer goes to drop blocks inside it: about an indent. */
const NEST_DISTANCE = 24;

/** Where dragged blocks would land: `place` of `block`, which is `pos`. */
interface Drop {
  block: Block;
  place: Place;
  pos: number;
}

/** A press on ⋮⋮: where it started, the blocks it takes, and whether it's a drag yet. */
interface Press {
  x: number;
  y: number;
  blocks: Block[];
  dragging: boolean;
}

/** The blocks being dragged, as decorations: they fade, and follow other people's changes. */
const dragKey = new PluginKey<DecorationSet>('blockDrag');

/** The icons, in the color of their button: + and six dots in two columns (⋮⋮). */
const PLUS =
  '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const GRIP = [9, 15]
  .flatMap((x) => [6, 12, 18].map((y) => `<circle cx="${x}" cy="${y}" r="1.5"/>`))
  .join('');

/** A button of the handle: `ch-block-handle-add` or `ch-block-handle-drag`. */
function button(name: 'add' | 'drag', label: string, title: string, shapes: string) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `ch-block-handle-button ch-block-handle-${name}`;
  // Not in the tab order: it only shows next to the block under the pointer.
  element.tabIndex = -1;
  element.setAttribute('aria-label', label);
  element.title = title;
  element.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${shapes}</svg>`;
  return element;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** `run()`, or null if it throws: positions read from the DOM can be out of date. */
function attempt<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

/** Moves `element`, drawn in the box around the page, to `left` and `top` on screen. */
function setPosition(element: HTMLElement, left: number, top: number) {
  const box = element.offsetParent ?? element.ownerDocument.documentElement;
  const rect = box.getBoundingClientRect();
  element.style.left = `${left - rect.left + box.scrollLeft - box.clientLeft}px`;
  element.style.top = `${top - rect.top + box.scrollTop - box.clientTop}px`;
}

/** The height of the first line of `element`: its line height, when it has more lines. */
function firstLineHeight(element: HTMLElement, rect: DOMRect): number {
  const height = Number.parseFloat(getComputedStyle(element).lineHeight);
  return height > 0 && height < rect.height ? height : rect.height;
}

/** Keys that type or delete something: the handle hides while you type, as the pointer rests. */
const typing = (event: KeyboardEvent) =>
  (event.key.length === 1 && !event.ctrlKey && !event.metaKey) ||
  ['Enter', 'Backspace', 'Delete'].includes(event.key);

class BlockHandleView {
  private readonly view: EditorView;
  private readonly editor: Editor;
  private readonly handle = document.createElement('div');
  private readonly line = document.createElement('div');
  private host: HTMLElement | null = null;
  /** The block the handle is next to, and its element. */
  private block: Block | null = null;
  private anchor: Node | null = null;
  private press: Press | null = null;
  private destroyed = false;

  constructor(view: EditorView, editor: Editor) {
    this.view = view;
    this.editor = editor;
    const add = button('add', 'Add a block', 'Click to add below\nAlt-click to add above', PLUS);
    const drag = button('drag', 'Drag to move', 'Drag to move\nAlt-drag to copy', GRIP);
    this.handle.className = 'ch-block-handle';
    this.handle.hidden = true;
    this.handle.append(add, drag);
    this.line.className = 'ch-drop-line';
    this.line.hidden = true;
    // Pressing a button leaves the cursor and the selection where they are.
    this.handle.addEventListener('mousedown', (event) => event.preventDefault());
    add.addEventListener('click', this.onAdd);
    drag.addEventListener('pointerdown', this.onPress);
    drag.addEventListener('click', this.onClick);
    view.dom.addEventListener('mousemove', this.onHover);
    view.dom.addEventListener('keydown', this.onType);
  }

  update(view: EditorView, previous: EditorState) {
    if (!this.editor.isEditable) {
      // Editing stopped (access changed, say), and so does a drag, once this update is done.
      if (this.press) {
        setTimeout(() => {
          this.stop();
          this.hide();
        });
      }
      this.hide();
    } else if (this.block && view.state.doc !== previous.doc) {
      // The page changed under the pointer: stay with the same block.
      const anchor = this.anchor;
      const pos = anchor?.isConnected ? attempt(() => view.posAtDOM(anchor, 0)) : null;
      const block = pos === null ? null : blockAt(view.state.doc, pos);
      if (block) this.show(block);
      else this.hide();
    }
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.view.dom.removeEventListener('mousemove', this.onHover);
    this.view.dom.removeEventListener('keydown', this.onType);
    this.host?.removeEventListener('mouseleave', this.hide);
    this.handle.remove();
    this.line.remove();
  }

  private onHover = (event: MouseEvent) => {
    if (this.press || !this.editor.isEditable) return;
    const block = this.blockUnder(event);
    if (block) this.show(block);
  };

  private onType = (event: KeyboardEvent) => {
    if (typing(event)) this.hide();
  };

  /** + adds a line below the block (Alt-click: above), and the "/" menu opens in it. */
  private onAdd = (event: MouseEvent) => {
    const { block, view } = this;
    if (!block || !this.editor.isEditable) return;
    const { tr } = view.state;
    // An empty line is used as it is.
    const empty = block.node.type.name === 'paragraph' && block.node.content.size === 0;
    const place = event.altKey ? 'before' : 'after';
    const pos = empty ? block.pos : insertLine(tr, dropPos(block, place));
    if (pos === null) return;
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    if (this.hasSlashMenu()) tr.insertText('/');
    view.dispatch(tr.scrollIntoView());
    view.focus();
    this.hide();
  };

  private onPress = (event: PointerEvent) => {
    const { block } = this;
    if (event.button !== 0 || !block || !this.editor.isEditable) return;
    event.preventDefault();
    // A block that's selected with others drags them all.
    const selected = selectedBlocks(this.view.state);
    const together = selected.length > 1 && selected.some((other) => other.pos === block.pos);
    this.press = {
      x: event.clientX,
      y: event.clientY,
      blocks: together ? selected : [block],
      dragging: false,
    };
    const doc = this.view.dom.ownerDocument;
    doc.addEventListener('pointermove', this.onMove);
    doc.addEventListener('pointerup', this.onRelease);
    doc.addEventListener('pointercancel', this.stop);
    doc.addEventListener('keydown', this.onKey, true);
  };

  /** A click that no pointer made, like one from a screen reader: selects the block. */
  private onClick = (event: MouseEvent) => {
    if (event.detail === 0 && this.block) this.select([this.block]);
  };

  private onMove = (event: PointerEvent) => {
    const { press } = this;
    if (!press) return;
    const { body } = this.view.dom.ownerDocument;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_DISTANCE) return;
      press.dragging = true;
      this.handle.hidden = true;
      body.classList.add('ch-block-dragging');
      this.view.dispatch(this.view.state.tr.setMeta(dragKey, press.blocks));
    }
    body.classList.toggle('ch-block-drag-copy', event.altKey);
    this.showLine(this.dropAt(event));
  };

  private onRelease = (event: PointerEvent) => {
    const { press } = this;
    if (!press) return;
    const drop = press.dragging ? this.dropAt(event) : null;
    const blocks = this.dragged();
    this.stop();
    if (!press.dragging) this.select(press.blocks);
    else if (drop) this.move(blocks, drop.pos, event.altKey);
  };

  /** Escape while dragging drops nothing, and goes no further. */
  private onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.stop();
  };

  private hasSlashMenu() {
    return this.editor.extensionManager.extensions.some(
      (extension) => extension.name === 'slashCommand' && Boolean(extension.options?.store),
    );
  }

  /** The block under the pointer: from the element it's over, or else from where it is. */
  private blockUnder(event: MouseEvent): Block | null {
    const { view } = this;
    const { doc } = view.state;
    const { target } = event;
    if (target instanceof Node && target !== view.dom && view.dom.contains(target)) {
      const pos = attempt(() => view.posAtDOM(target, 0));
      // In a list but next to its items (its padding): find the item by where the pointer is.
      if (pos !== null && !isList(doc.resolve(pos).parent)) return blockAt(doc, pos);
    }
    const box = view.dom.getBoundingClientRect();
    const coords = {
      left: clamp(event.clientX, box.left + 1, box.right - 1),
      top: clamp(event.clientY, box.top + 1, box.bottom - 1),
    };
    const found = attempt(() => view.posAtCoords(coords));
    if (!found) return null;
    // Over a block with no text, like a divider or a database: that block.
    const inside = found.inside >= 0 ? doc.nodeAt(found.inside) : null;
    return blockAt(doc, inside?.isBlock && inside.isAtom ? found.inside : found.pos);
  }

  /** The element of the block's own line (its first line if blocks are nested in it), on screen. */
  private lineOf(block: Block): { element: HTMLElement; rect: DOMRect } | null {
    const element = this.view.nodeDOM(hasTitle(block.node) ? block.pos + 1 : block.pos);
    return element instanceof HTMLElement
      ? { element, rect: element.getBoundingClientRect() }
      : null;
  }

  /** Where the block starts on screen: for a list item, left of its bullet or number. */
  private leftOf(block: Block): number | null {
    const { view } = this;
    const $pos = view.state.doc.resolve(block.pos);
    const list = $pos.depth > 0 && isList($pos.parent) ? view.nodeDOM($pos.before()) : null;
    const element = list instanceof HTMLElement ? list : view.nodeDOM(block.pos);
    return element instanceof HTMLElement ? element.getBoundingClientRect().left : null;
  }

  private show(block: Block) {
    const host = this.view.dom.parentElement;
    const line = this.lineOf(block);
    const left = this.leftOf(block);
    if (!host || !line || left === null) {
      this.hide();
      return;
    }
    if (this.host !== host) {
      this.host?.removeEventListener('mouseleave', this.hide);
      host.addEventListener('mouseleave', this.hide);
      host.append(this.handle, this.line);
      this.host = host;
    }
    this.block = block;
    this.anchor = this.view.nodeDOM(block.pos);
    this.handle.hidden = false;
    // Centred on the block's first line.
    const { offsetHeight, offsetWidth } = this.handle;
    const top = line.rect.top + (firstLineHeight(line.element, line.rect) - offsetHeight) / 2;
    setPosition(this.handle, left - offsetWidth, top);
  }

  private hide = () => {
    if (this.press) return;
    this.block = null;
    this.anchor = null;
    this.handle.hidden = true;
  };

  /** The blocks being dragged, where they are now: other people may be editing the page. */
  private dragged(): Block[] {
    const { state } = this.view;
    const decorations = dragKey.getState(state)?.find() ?? [];
    return decorations.flatMap(({ from, to }) => {
      const node = state.doc.nodeAt(from);
      return node && from + node.nodeSize === to ? [{ node, pos: from }] : [];
    });
  }

  /** Where the dragged blocks would land with the pointer at `event`, or null for nowhere. */
  private dropAt(event: MouseEvent): Drop | null {
    const hovered = this.blockUnder(event);
    const line = hovered && this.lineOf(hovered);
    if (!hovered || !line) return null;
    const { clientX: x, clientY: y } = event;
    const { rect } = line;
    let block = hovered;
    let place: Place = 'after';
    if (y < rect.top + rect.height / 2) place = 'before';
    else if (
      hasTitle(hovered.node) &&
      (hovered.node.childCount > 1 || y > rect.bottom || x > rect.left + NEST_DISTANCE)
    ) {
      place = 'inside';
    } else {
      // Below nested blocks, the further left the pointer is, the further out they land.
      const levels = blocksEndingWith(this.view.state.doc, hovered);
      block = levels.find((level) => (this.leftOf(level) ?? x) <= x) ?? hovered;
    }
    const pos = dropPos(block, place);
    const blocks = this.dragged();
    // Never into the dragged blocks themselves, and only where they fit.
    if (blocks.some((other) => pos > other.pos && pos < other.pos + other.node.nodeSize)) {
      return null;
    }
    return moveBlocks(this.view.state.tr, blocks, pos) ? { block, place, pos } : null;
  }

  /** The blue line where the blocks will land, as wide as the blocks at that level. */
  private showLine(drop: Drop | null) {
    const at = drop && this.lineAt(drop);
    this.line.hidden = !at;
    if (!at) return;
    setPosition(this.line, at.left, at.top - 1);
    this.line.style.width = `${Math.max(0, at.width)}px`;
  }

  private lineAt({ block, place }: Drop): { left: number; top: number; width: number } | null {
    const element = this.view.nodeDOM(block.pos);
    const line = this.lineOf(block);
    const left = this.leftOf(block);
    if (!(element instanceof HTMLElement) || !line || left === null) return null;
    const { right } = this.view.dom.getBoundingClientRect();
    if (place === 'before') return { left, top: line.rect.top, width: right - left };
    if (place === 'inside') {
      return { left: line.rect.left, top: line.rect.bottom, width: right - line.rect.left };
    }
    return { left, top: element.getBoundingClientRect().bottom, width: right - left };
  }

  private move(blocks: readonly Block[], pos: number, copy: boolean) {
    const { view } = this;
    const { tr } = view.state;
    const landed = moveBlocks(tr, blocks, pos, { copy });
    // Dropped where they were: nothing to do.
    if (landed && !tr.doc.eq(view.state.doc)) {
      const selection = selectionIn(tr.doc, landed);
      if (selection) tr.setSelection(selection);
      // An undo step of its own: Ctrl+Z takes back the move, not the typing just before it.
      newUndoStep(view.state);
      view.dispatch(tr);
      newUndoStep(view.state);
    }
    view.focus();
  }

  /** A click on ⋮⋮: selects its block, or keeps the selected blocks it is one of. */
  private select(blocks: readonly Block[]) {
    const { view } = this;
    const [block] = blocks;
    if (blocks.length === 1 && block && view.state.doc.nodeAt(block.pos) === block.node) {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos)));
    }
    view.focus();
  }

  /** Ends a press or a drag. */
  private stop = () => {
    if (!this.press) return;
    this.press = null;
    const doc = this.view.dom.ownerDocument;
    doc.removeEventListener('pointermove', this.onMove);
    doc.removeEventListener('pointerup', this.onRelease);
    doc.removeEventListener('pointercancel', this.stop);
    doc.removeEventListener('keydown', this.onKey, true);
    doc.body.classList.remove('ch-block-dragging', 'ch-block-drag-copy');
    this.line.hidden = true;
    if (!this.destroyed && this.dragged().length > 0) {
      this.view.dispatch(this.view.state.tr.setMeta(dragKey, null));
    }
  };
}

/**
 * The + and ⋮⋮ left of the block under the pointer. + adds a line below (Alt-click: above) and
 * opens the "/" menu in it. Dragging ⋮⋮ moves the block, or all the selected blocks if it's one
 * of them, to where the blue line shows, in one undo step; Alt-drag copies; Escape cancels. A
 * click on ⋮⋮ selects the block. A read-only editor shows neither.
 */
export const BlockHandle = Extension.create({
  name: 'blockHandle',

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin<DecorationSet>({
        key: dragKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, dragged) {
            const blocks = tr.getMeta(dragKey) as Block[] | null | undefined;
            if (blocks === undefined) return dragged.map(tr.mapping, tr.doc);
            const decorations = (blocks ?? []).map(({ node, pos }) =>
              Decoration.node(pos, pos + node.nodeSize, { class: 'ch-block-dragged' }),
            );
            return DecorationSet.create(tr.doc, decorations);
          },
        },
        props: {
          decorations: (state) => dragKey.getState(state),
        },
        view: (view) => new BlockHandleView(view, editor),
      }),
    ];
  },
});
