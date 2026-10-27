import { Extension, type Range } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import { blockSlashItems } from './blocks/ui';
import type { SlashItem } from './types';

/** The spec's groups, in menu order. Other groups follow in the order they first appear. */
const GROUPS = ['Suggested', 'Basic blocks', 'Media', 'Database', 'Advanced', 'Inline', 'Embeds'];
/** Always the last group. */
const LAST_GROUP = 'Actions';
const MAX_RECENT = 5;
/** Characters past the longest prefix that still matches something before the menu closes. */
const MISSES_TO_CLOSE = 3;

export const groupOf = (item: SlashItem) => item.group ?? 'Other';

function rank(group: string) {
  if (group === LAST_GROUP) return GROUPS.length + 1;
  const index = GROUPS.indexOf(group);
  return index === -1 ? GROUPS.length : index;
}

/** `base` plus `extra`; an extra entry with the id of a base entry takes its place. */
export function mergeSlashItems(
  base: readonly SlashItem[],
  extra: readonly SlashItem[] = [],
): SlashItem[] {
  const byId = new Map(extra.map((item) => [item.id, item]));
  const baseIds = new Set(base.map((item) => item.id));
  return [
    ...base.map((item) => byId.get(item.id) ?? item),
    ...[...byId.values()].filter((item) => !baseIds.has(item.id)),
  ];
}

/**
 * The entries whose title or keywords contain `query` (ignoring case), kept together by group:
 * the spec's groups first, "Actions" last, others in between in the order they first appear.
 */
export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLowerCase();
  const found = items.filter(
    (item) =>
      !needle ||
      [item.title, ...(item.keywords ?? [])].some((word) => word.toLowerCase().includes(needle)),
  );
  const groups = [...new Set(found.map(groupOf))].sort((a, b) => rank(a) - rank(b));
  return groups.flatMap((group) => found.filter((item) => groupOf(item) === group));
}

export interface SlashMenuState {
  query: string;
  items: SlashItem[];
  /** Index of the active option. */
  index: number;
  /** Where the typed "/" is on screen. */
  rect: DOMRect | null;
}

type Props = SuggestionProps<SlashItem, SlashItem>;

/** State of the "/" menu, shared between the editor plugin and the React menu. */
export class SlashMenuStore {
  private state: SlashMenuState | null = null;
  private props: Props | null = null;
  private listeners = new Set<() => void>();
  private items: SlashItem[] = [...blockSlashItems];
  private recent: string[] = [];
  private readonly storageKey: string | undefined;

  /** With a `storageKey`, the blocks you used last are kept in localStorage under it. */
  constructor(storageKey?: string) {
    this.storageKey = storageKey;
    if (!storageKey) return;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(saved)) {
        this.recent = saved.filter((id): id is string => typeof id === 'string');
        this.recent = this.recent.slice(0, MAX_RECENT);
      }
    } catch {
      // Storage is blocked or holds something else: start without recent blocks.
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  /** Offers the block groups' entries plus `extra` (an entry with a block's id replaces it). */
  setItems(extra?: readonly SlashItem[]) {
    this.items = mergeSlashItems(blockSlashItems, extra);
  }

  /** The matching entries; with nothing typed yet, the blocks you used last come first. */
  find(query: string): SlashItem[] {
    const found = filterSlashItems(this.items, query);
    if (query.trim()) return found;
    const suggested = this.recent.flatMap((id) => {
      const item = this.items.find((entry) => entry.id === id);
      return item ? [{ ...item, group: 'Suggested' }] : [];
    });
    return [...suggested, ...found];
  }

  /** True once `query` has gone `MISSES_TO_CLOSE` characters past anything that matches. */
  closesAt(query: string): boolean {
    let matching = query.length;
    while (matching > 0 && filterSlashItems(this.items, query.slice(0, matching)).length === 0) {
      matching -= 1;
    }
    return query.length - matching >= MISSES_TO_CLOSE;
  }

  /** Puts `id` first among the recent blocks. */
  remember(id: string) {
    this.recent = [id, ...this.recent.filter((other) => other !== id)].slice(0, MAX_RECENT);
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.recent));
    } catch {
      // Storage is full or blocked: the recent blocks last until the page reloads.
    }
  }

  private set(state: SlashMenuState | null) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  show(props: Props) {
    const previous = this.state;
    this.props = props;
    this.set({
      query: props.query,
      items: props.items,
      index: previous?.query === props.query ? Math.min(previous.index, props.items.length - 1) : 0,
      rect: props.clientRect?.() ?? null,
    });
  }

  hide() {
    this.props = null;
    this.set(null);
  }

  setIndex(index: number) {
    if (this.state && this.state.index !== index) this.set({ ...this.state, index });
  }

  /** Runs `item`, or the active option. */
  select(item?: SlashItem) {
    const chosen = item ?? this.state?.items[this.state.index];
    if (chosen && this.props) this.props.command(chosen);
  }

  keyDown(event: KeyboardEvent, view: EditorView, range: Range): boolean {
    if (event.key === 'Escape') {
      view.dispatch(view.state.tr.setMeta(dismissedKey, range.from).setMeta('addToHistory', false));
      return true;
    }
    const state = this.state;
    if (!state || state.items.length === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.setIndex((state.index + step + state.items.length) % state.items.length);
      return true;
    }
    if (event.key === 'Enter') {
      this.select();
      return true;
    }
    return false;
  }
}

/** Where the "/" is that someone closed with Escape; the menu stays closed for it. */
const dismissedKey = new PluginKey<number | null>('slashMenuDismissed');

const dismissed = new Plugin<number | null>({
  key: dismissedKey,
  state: {
    init: () => null,
    apply(tr, at) {
      const meta = tr.getMeta(dismissedKey) as number | undefined;
      if (meta !== undefined) return meta;
      if (at === null || !tr.docChanged) return at;
      const mapped = tr.mapping.mapResult(at);
      const kept = !mapped.deleted && mapped.pos < tr.doc.content.size;
      return kept && tr.doc.textBetween(mapped.pos, mapped.pos + 1) === '/' ? mapped.pos : null;
    },
  },
});

const slashMenuKey = new PluginKey('slashMenu');

/** Opens the "/" menu when someone types "/" at the start of a line or after a space. */
export const SlashCommand = Extension.create<{ store: SlashMenuStore | null }>({
  name: 'slashCommand',
  priority: 200,

  addOptions() {
    return { store: null };
  },

  addProseMirrorPlugins() {
    const { store } = this.options;
    if (!store) return [];
    return [
      // Before the menu's own plugin, so `allow` sees this transaction's dismissed "/".
      dismissed,
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashMenuKey,
        char: '/',
        allowSpaces: true,
        allow: ({ state, range }) =>
          !state.doc.resolve(range.from).parent.type.spec.code &&
          dismissedKey.getState(state) !== range.from &&
          !store.closesAt(state.doc.textBetween(range.from + 1, range.to)),
        items: ({ query }) => store.find(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
          store.remember(props.id);
        },
        render: () => ({
          onStart: (props) => store.show(props),
          onUpdate: (props) => store.show(props),
          onExit: () => store.hide(),
          onKeyDown: ({ event, view, range }) => store.keyDown(event, view, range),
        }),
      }),
    ];
  },
});
