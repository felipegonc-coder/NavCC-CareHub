// Test helpers: a small stand-in for ProseMirror's documents and Tiptap's editor, so writing help's
// tests need none of the editor's packages.
import type { PageDoc, PageNode, PageSpot } from './editor';
import type { ViewedEditor } from './open';

// Sizes and positions count the same way as ProseMirror's.
export interface Fake extends PageNode {
  readonly children: Fake[];
}

export function text(value: string): Fake {
  return {
    type: { name: 'text' },
    isText: true,
    isTextblock: false,
    text: value,
    nodeSize: value.length,
    childCount: 0,
    child: () => {
      throw new Error('Text has no children');
    },
    children: [],
  };
}

export function node(name: string, children: Fake[], isTextblock = false, leaf = false): Fake {
  const size = children.reduce((sum, child) => sum + child.nodeSize, 0);
  return {
    type: { name },
    isText: false,
    isTextblock,
    nodeSize: leaf ? 1 : size + 2,
    childCount: children.length,
    child: (index) => children[index] as Fake,
    children,
  };
}

export const p = (...content: string[]) => node('paragraph', content.map(text), true);
export const br = () => node('hardBreak', [], false, true);
export const mention = () => node('mention', [], false, true);

export function doc(...blocks: Fake[]): PageDoc {
  const root = node('doc', blocks);
  const resolve = (pos: number): PageSpot => {
    const path: { node: Fake; start: number }[] = [{ node: root, start: 0 }];
    for (;;) {
      const { node: current, start } = path[path.length - 1] as { node: Fake; start: number };
      let offset = start;
      let inside: { node: Fake; start: number } | null = null;
      for (const child of current.children) {
        const end = offset + child.nodeSize;
        if (!child.isText && child.nodeSize > 1 && pos > offset && pos < end) {
          inside = { node: child, start: offset + 1 };
          break;
        }
        offset = end;
      }
      if (!inside) break;
      path.push(inside);
    }
    const depth = path.length - 1;
    const at = (d = depth) => path[d] as { node: Fake; start: number };
    const size = (d = depth) => at(d).node.nodeSize - (d === 0 ? 0 : 2);
    return {
      depth,
      parent: at().node,
      parentOffset: pos - at().start,
      start: (d) => at(d).start,
      end: (d) => at(d).start + size(d),
      before: (d) => at(d).start - 1,
      after: (d) => at(d).start + size(d) + 1,
      node: (d) => at(d).node,
    };
  };
  return { ...root, nodeSize: root.nodeSize - 2, resolve };
}

export type Inserted = [position: unknown, content: unknown];

export function fakeEditor(page: PageDoc, selection = { from: 0, to: 0 }, dom?: HTMLElement) {
  const inserted: Inserted[] = [];
  const handlers = new Set<(props: { transaction: unknown }) => void>();
  let focused = false;
  const chain = {
    focus: () => {
      focused = true;
      return chain;
    },
    insertContentAt: (position: unknown, content: unknown) => {
      inserted.push([position, content]);
      return chain;
    },
    run: () => true,
  };
  const destroyHandlers = new Set<() => void>();
  let viewFocused = false;
  const editor = {
    state: { doc: page, selection },
    isEditable: true,
    isDestroyed: false,
    chain: () => chain,
    on: (event: string, handler: (props: { transaction: unknown }) => void) =>
      event === 'destroy' ? destroyHandlers.add(handler as () => void) : handlers.add(handler),
    off: (event: string, handler: (props: { transaction: unknown }) => void) =>
      event === 'destroy'
        ? destroyHandlers.delete(handler as () => void)
        : handlers.delete(handler),
    view: dom && {
      dom,
      coordsAtPos: (pos: number) => ({ left: pos, right: pos + 1, top: 10, bottom: 30 }),
      focus: () => {
        viewFocused = true;
      },
    },
  };
  return {
    editor: editor as unknown as ViewedEditor & {
      state: { doc: PageDoc; selection: { from: number; to: number } };
    },
    viewFocused: () => viewFocused,
    destroy() {
      editor.isDestroyed = true;
      for (const handler of destroyHandlers) handler();
    },
    inserted,
    handlers,
    focused: () => focused,
    /** An edit: the new page, and how old positions move (an insertion of `size` at `at`). */
    edit(next: PageDoc, at: number, size: number) {
      (editor.state as { doc: PageDoc }).doc = next;
      const map = (pos: number, assoc = 1) =>
        pos > at || (pos === at && assoc > 0) ? pos + size : pos;
      for (const handler of handlers)
        handler({ transaction: { docChanged: true, mapping: { map } } });
    },
  };
}
