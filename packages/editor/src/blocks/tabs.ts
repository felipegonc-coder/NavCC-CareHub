import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core';
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';

/** The most tabs one tabs block can have (Pages and blocks, Tabs). */
export const MAX_TABS = 20;

/** The longest a tab's name can be, in characters. */
export const MAX_TAB_NAME = 100;

/** The sizes the tab labels of a tabs block can have. */
export const TAB_LABEL_SIZES = ['small', 'default', 'large'] as const;
export type TabLabelSize = (typeof TAB_LABEL_SIZES)[number];

/** A tab's icon, stored like a page icon: an emoji, or an icon by name with a color name. */
export type TabIcon =
  { type: 'emoji'; emoji: string } | { type: 'icon'; name: string; color?: string | null };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tabs: {
      /**
       * A tabs block with "Tab 1" and "Tab 2", each with an empty line, in place of an empty
       * line, or else below the cursor's block. The cursor goes into the first tab.
       */
      insertTabs: () => ReturnType;
      /** Adds "Tab <n>" at `index` (at the end by default) and puts the cursor in it. */
      addTab: (tabsPos: number, index?: number) => ReturnType;
      /** Renames a tab. A name that is empty once cleaned up changes nothing. */
      renameTab: (tabsPos: number, index: number, name: string) => ReturnType;
      /** Sets a tab's icon, or removes it with null. */
      setTabIcon: (tabsPos: number, index: number, icon: TabIcon | null) => ReturnType;
      /** Puts a copy of a tab, with copies of its blocks, right after it. */
      duplicateTab: (tabsPos: number, index: number) => ReturnType;
      /** Moves the tab at `from` so it ends up at index `to`. */
      moveTab: (tabsPos: number, from: number, to: number) => ReturnType;
      /** Deletes a tab and its blocks. Deleting the only tab deletes the tabs block. */
      deleteTab: (tabsPos: number, index: number) => ReturnType;
      /** Sets the size of the tab labels. */
      setTabLabelSize: (tabsPos: number, size: TabLabelSize) => ReturnType;
    };
  }
}

const TABS = 'tabs';
const TAB = 'tab';
const TAB_ID = 'tabId';

// Typed by what they read, so the schema needs no DOM types (the server loads it too).
type HtmlSource = { getAttribute(name: string): string | null };
type Values = Record<string, unknown>;

/** Bidirectional text controls, which could make a name read differently from what it holds. */
const isBidiControl = (code: number) =>
  (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);

/**
 * A tab name as it is stored: one line, trimmed, without control characters, at most
 * MAX_TAB_NAME characters. Empty if nothing is left.
 */
export function cleanTabName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const printable = Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return ' ';
    return isBidiControl(code) ? '' : char;
  }).join('');
  const name = printable.replace(/\s+/g, ' ').trim();
  return Array.from(name).slice(0, MAX_TAB_NAME).join('').trim();
}

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component})+$/u;
const ICON_NAME = /^[a-z\d]+(?:-[a-z\d]+)*$/;
const COLOR_NAME = /^[a-z]+(?:-[a-z]+)*$/;

/** A tab icon as it is stored, or null if `value` isn't one. */
export function cleanTabIcon(value: unknown): TabIcon | null {
  if (typeof value !== 'object' || value === null) return null;
  const icon = value as Values;
  if (icon.type === 'emoji' && typeof icon.emoji === 'string') {
    const emoji = icon.emoji.trim();
    const pictured = Array.from(emoji).some((char) => (char.codePointAt(0) ?? 0) > 0x7f);
    return emoji.length <= 32 && pictured && EMOJI.test(emoji) ? { type: 'emoji', emoji } : null;
  }
  if (icon.type === 'icon' && typeof icon.name === 'string') {
    if (icon.name.length > 64 || !ICON_NAME.test(icon.name)) return null;
    const { color } = icon;
    const named = typeof color === 'string' && color.length <= 32 && COLOR_NAME.test(color);
    return { type: 'icon', name: icon.name, color: named ? color : null };
  }
  return null;
}

const readJson = (text: string | null): unknown => {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

const isLabelSize = (value: unknown): value is TabLabelSize =>
  TAB_LABEL_SIZES.some((size) => size === value);

/** A tab's name as shown where it has none. */
const UNTITLED = 'Untitled';

/** The label of a tab in HTML: its emoji, if it has one, and its name. */
function tabLabel(tab: ProseMirrorNode): string {
  const icon = cleanTabIcon(tab.attrs.icon);
  const name = cleanTabName(tab.attrs.name) || UNTITLED;
  return icon?.type === 'emoji' ? `${icon.emoji} ${name}` : name;
}

interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/** A new tab ID: a random UUID (version 4). */
function newTabId(): string {
  const random = (globalThis as unknown as { crypto?: RandomSource }).crypto;
  if (random?.randomUUID) return random.randomUUID();
  // Outside HTTPS, browsers have getRandomValues but not randomUUID.
  const bytes = new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
  random?.getRandomValues?.(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

const tabIdOf = (tab: ProseMirrorNode): string | null => {
  const id: unknown = tab.attrs[TAB_ID];
  return typeof id === 'string' && id !== '' ? id : null;
};

/** The tabs block that starts at `pos`, or null. */
function tabsAt(doc: ProseMirrorNode, pos: number): ProseMirrorNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node?.type.name === TABS ? node : null;
}

/** Where the tab at `index` of the tabs block at `tabsPos` starts (its end, past the last). */
function tabStart(tabs: ProseMirrorNode, tabsPos: number, index: number): number {
  let pos = tabsPos + 1;
  for (let i = 0; i < index && i < tabs.childCount; i += 1) pos += tabs.child(i).nodeSize;
  return pos;
}

/** The tab at `index` of the tabs block at `tabsPos`, and where it starts; null if none. */
function tabAt(
  doc: ProseMirrorNode,
  tabsPos: number,
  index: number,
): { tabs: ProseMirrorNode; node: ProseMirrorNode; pos: number } | null {
  const tabs = tabsAt(doc, tabsPos);
  if (!tabs || !Number.isInteger(index) || index < 0 || index >= tabs.childCount) return null;
  return { tabs, node: tabs.child(index), pos: tabStart(tabs, tabsPos, index) };
}

/** A new tab with one empty line. */
const newTab = (type: NodeType, name: string) => type.createAndFill({ [TAB_ID]: newTabId(), name });

/** "Tab <n>": n is one more than the number of tabs, or the next number no tab is named after. */
function nextTabName(tabs: ProseMirrorNode): string {
  const taken = new Set<string>();
  tabs.forEach((tab) => taken.add(cleanTabName(tab.attrs.name)));
  let number = tabs.childCount + 1;
  while (taken.has(`Tab ${number}`)) number += 1;
  return `Tab ${number}`;
}

/**
 * Where a new block goes: in place of the line the selection ends in if it's empty, or else
 * right after the closest block around it that may have one after it.
 */
function insertionPoint(selection: Selection, type: NodeType): { from: number; to: number } | null {
  const { $to, empty } = selection;
  if (empty && $to.depth > 0 && $to.parent.isTextblock && $to.parent.content.size === 0) {
    const index = $to.index($to.depth - 1);
    if ($to.node($to.depth - 1).canReplaceWith(index, index + 1, type)) {
      return { from: $to.before(), to: $to.after() };
    }
  }
  for (let depth = $to.depth; depth > 0; depth -= 1) {
    const index = $to.index(depth - 1) + 1;
    if ($to.node(depth - 1).canReplaceWith(index, index, type)) {
      const pos = $to.after(depth);
      return { from: pos, to: pos };
    }
  }
  // A selected block at the top of the page: right after it.
  const index = $to.index(0);
  return $to.depth === 0 && $to.parent.canReplaceWith(index, index, type)
    ? { from: $to.pos, to: $to.pos }
    : null;
}

interface SelectionJson {
  type: string;
  anchor?: number;
  head?: number;
}

/** The same selection `by` positions further on. */
function shifted(selection: SelectionJson, by: number): SelectionJson {
  const { anchor, head } = selection;
  return {
    ...selection,
    ...(anchor === undefined ? {} : { anchor: anchor + by }),
    ...(head === undefined ? {} : { head: head + by }),
  };
}

/** Transactions that bring changes from the Y.Doc: other people's, undo and redo, loading. */
function fromYjs(state: EditorState): (tr: Transaction) => boolean {
  const sync = state.plugins.find((plugin) =>
    String((plugin as unknown as { key?: unknown }).key).startsWith('y-sync$'),
  );
  return (tr) => sync !== undefined && tr.getMeta(sync) !== undefined;
}

/**
 * Gives a tab ID to every tab your own changes made or touched that has none, and a new one to
 * a copy of a tab whose ID another tab already has (the one that comes first keeps it).
 */
function fillTabIds(transactions: readonly Transaction[], state: EditorState): Transaction | null {
  const isFromYjs = fromYjs(state);
  if (!transactions.some((tr) => tr.docChanged && !isFromYjs(tr))) return null;

  // The ranges your changes touched, in today's positions.
  const ranges: { from: number; to: number }[] = [];
  for (const tr of transactions) {
    const mine = !isFromYjs(tr);
    for (const map of tr.mapping.maps) {
      for (const range of ranges) {
        range.from = map.map(range.from, -1);
        range.to = map.map(range.to, 1);
      }
      if (mine) map.forEach((_oldFrom, _oldTo, from, to) => ranges.push({ from, to }));
    }
  }

  const { doc } = state;
  const missing = new Set<number>();
  const placed = new Set<string>();
  for (const { from, to } of ranges) {
    doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node, pos) => {
      if (node.type.name === TAB) {
        const id = tabIdOf(node);
        if (id === null) missing.add(pos);
        else if (pos >= from) placed.add(id);
      }
      return !node.isTextblock;
    });
  }
  if (missing.size === 0 && placed.size === 0) return null;

  const changes = new Map<number, string>();
  if (placed.size > 0) {
    const seen = new Set<string>();
    doc.descendants((node, pos) => {
      const id = node.type.name === TAB ? tabIdOf(node) : null;
      if (id !== null && seen.has(id) && placed.has(id)) changes.set(pos, newTabId());
      else if (id !== null) seen.add(id);
      return !node.isTextblock;
    });
  }
  for (const pos of missing) changes.set(pos, newTabId());
  if (changes.size === 0) return null;
  const { tr } = state;
  for (const [pos, id] of changes) tr.setNodeAttribute(pos, TAB_ID, id);
  return tr;
}

const tabIdsKey = new PluginKey('tabIds');

/**
 * One tab of a tabs block, with its own blocks. `tabId` is a UUID, never read from HTML, so a
 * pasted tab is a new tab; which tab each person has open goes by it. `name` and `icon` are
 * what its label shows. In HTML the tab starts with its label in bold, so a paste into another
 * app shows it; Care Hub skips that line when it reads the HTML back.
 */
const Tab = Node.create({
  name: TAB,
  content: 'block+',
  // Its first line never joins the tab before it, and lines never leave it with Backspace.
  isolating: true,

  addAttributes() {
    return {
      [TAB_ID]: {
        default: null,
        parseHTML: () => null,
        renderHTML: (attributes: Values) => {
          const id: unknown = attributes[TAB_ID];
          return typeof id === 'string' ? { 'data-tab-id': id } : {};
        },
      },
      name: {
        default: '',
        parseHTML: (element: HtmlSource) => cleanTabName(element.getAttribute('data-tab-name')),
        renderHTML: (attributes: Values) => ({
          'data-tab-name': cleanTabName(attributes.name),
        }),
      },
      icon: {
        default: null,
        parseHTML: (element: HtmlSource) =>
          cleanTabIcon(readJson(element.getAttribute('data-tab-icon'))),
        renderHTML: (attributes: Values) => {
          const icon = cleanTabIcon(attributes.icon);
          return icon ? { 'data-tab-icon': JSON.stringify(icon) } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="tab"]' },
      // The label line that starts each tab in HTML.
      { tag: 'p[data-tab-label]', ignore: true, priority: 60 },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'tab' }),
      ['p', { 'data-tab-label': '', contenteditable: 'false' }, ['strong', tabLabel(node)]],
      ['div', { 'data-tab-content': '' }, 0],
    ];
  },
});

/**
 * Tabs: a row of tabs, each holding its own blocks (Pages and blocks, Tabs). `labelSize` is the
 * size of the tab labels. At most MAX_TABS tabs: the commands stop there, the schema doesn't,
 * so a page from another client always loads. Which tab is open is per person, never stored
 * here.
 */
const Tabs = Node.create({
  name: TABS,
  group: 'block',
  content: 'tab+',
  // Lines around it never join a tab's lines.
  isolating: true,

  addAttributes() {
    return {
      labelSize: {
        default: 'default',
        parseHTML: (element: HtmlSource) => {
          const size = element.getAttribute('data-label-size');
          return isLabelSize(size) ? size : 'default';
        },
        renderHTML: (attributes: Values) => {
          const size = attributes.labelSize;
          return isLabelSize(size) && size !== 'default' ? { 'data-label-size': size } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="tabs"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'tabs' }), 0];
  },

  addCommands() {
    return {
      insertTabs:
        () =>
        ({ tr, dispatch }) => {
          const tabType = this.type.contentMatch.defaultType;
          const place = insertionPoint(tr.selection, this.type);
          const first = tabType ? newTab(tabType, 'Tab 1') : null;
          const second = tabType ? newTab(tabType, 'Tab 2') : null;
          if (!place || !first || !second) return false;
          if (dispatch) {
            tr.replaceWith(place.from, place.to, this.type.create(null, [first, second]));
            // Into the tabs block, its first tab and that tab's line.
            tr.setSelection(TextSelection.create(tr.doc, place.from + 3)).scrollIntoView();
          }
          return true;
        },

      addTab:
        (tabsPos, index) =>
        ({ tr, dispatch }) => {
          const tabs = tabsAt(tr.doc, tabsPos);
          const at = index ?? tabs?.childCount ?? 0;
          const tabType = tabs?.firstChild?.type;
          if (!tabs || !tabType || tabs.childCount >= MAX_TABS) return false;
          if (!Number.isInteger(at) || at < 0 || at > tabs.childCount) return false;
          const tab = newTab(tabType, nextTabName(tabs));
          if (!tab) return false;
          if (dispatch) {
            const pos = tabStart(tabs, tabsPos, at);
            tr.insert(pos, tab);
            tr.setSelection(Selection.near(tr.doc.resolve(pos + 1))).scrollIntoView();
          }
          return true;
        },

      renameTab:
        (tabsPos, index, name) =>
        ({ tr, dispatch }) => {
          const tab = tabAt(tr.doc, tabsPos, index);
          const clean = cleanTabName(name);
          if (!tab || !clean) return false;
          if (dispatch && clean !== tab.node.attrs.name) {
            tr.setNodeAttribute(tab.pos, 'name', clean);
          }
          return true;
        },

      setTabIcon:
        (tabsPos, index, icon) =>
        ({ tr, dispatch }) => {
          const tab = tabAt(tr.doc, tabsPos, index);
          const clean = icon === null ? null : cleanTabIcon(icon);
          if (!tab || (icon !== null && clean === null)) return false;
          if (dispatch) tr.setNodeAttribute(tab.pos, 'icon', clean);
          return true;
        },

      duplicateTab:
        (tabsPos, index) =>
        ({ tr, dispatch }) => {
          const tab = tabAt(tr.doc, tabsPos, index);
          if (!tab || tab.tabs.childCount >= MAX_TABS) return false;
          if (dispatch) {
            const { node } = tab;
            const name = cleanTabName(`${cleanTabName(node.attrs.name) || UNTITLED} (copy)`);
            const copy = node.type.create(
              { ...node.attrs, [TAB_ID]: newTabId(), name },
              node.content,
            );
            const pos = tab.pos + node.nodeSize;
            tr.insert(pos, copy);
            tr.setSelection(Selection.near(tr.doc.resolve(pos + 1))).scrollIntoView();
          }
          return true;
        },

      moveTab:
        (tabsPos, from, to) =>
        ({ tr, dispatch }) => {
          const tab = tabAt(tr.doc, tabsPos, from);
          if (!tab || !Number.isInteger(to) || to < 0 || to >= tab.tabs.childCount) return false;
          if (to === from) return false;
          if (dispatch) {
            const { node, pos } = tab;
            // Where it goes, worked out before it's taken out.
            const target =
              to < from
                ? tabStart(tab.tabs, tabsPos, to)
                : tabStart(tab.tabs, tabsPos, to + 1) - node.nodeSize;
            // A selection in the moved tab moves with it.
            const { selection } = tr;
            const inside = selection.from > pos && selection.to < pos + node.nodeSize;
            const kept = inside ? (selection.toJSON() as SelectionJson) : null;
            tr.delete(pos, pos + node.nodeSize);
            tr.insert(target, node);
            if (kept) tr.setSelection(Selection.fromJSON(tr.doc, shifted(kept, target - pos)));
          }
          return true;
        },

      deleteTab:
        (tabsPos, index) =>
        ({ tr, dispatch }) => {
          const tab = tabAt(tr.doc, tabsPos, index);
          if (!tab) return false;
          if (dispatch) {
            // A selection in it goes to the tab that takes its place, or to the one before.
            if (tab.tabs.childCount === 1) tr.delete(tabsPos, tabsPos + tab.tabs.nodeSize);
            else tr.delete(tab.pos, tab.pos + tab.node.nodeSize);
            tr.scrollIntoView();
          }
          return true;
        },

      setTabLabelSize:
        (tabsPos, size) =>
        ({ tr, dispatch }) => {
          if (!tabsAt(tr.doc, tabsPos) || !isLabelSize(size)) return false;
          if (dispatch) tr.setNodeAttribute(tabsPos, 'labelSize', size);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: tabIdsKey,
        appendTransaction: (transactions, _before, state) =>
          editor.isEditable ? fillTabIds(transactions, state) : null,
      }),
    ];
  },
});

// The tabs group: tabs blocks and their tabs. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Tabs, Tab];
