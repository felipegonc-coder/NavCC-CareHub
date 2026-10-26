import { Extension, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import { BASIC_BLOCKS, filterSlashItems, mergeSlashItems } from './blocks';
import type { SlashItem } from './types';

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
  private items: SlashItem[] = [...BASIC_BLOCKS];
  /** Position of a "/" the user dismissed with Escape; the menu stays closed there. */
  dismissedAt: number | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  /** Offers the basic blocks plus `extra` (an entry with a basic block's id replaces it). */
  setItems(extra?: readonly SlashItem[]) {
    this.items = mergeSlashItems(BASIC_BLOCKS, extra);
  }

  find(query: string): SlashItem[] {
    return filterSlashItems(this.items, query);
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
      this.dismissedAt = range.from;
      // Any transaction makes the plugin check `allow` again, which now closes the menu.
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
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

const slashMenuKey = new PluginKey('slashMenu');

/** Opens the block menu when someone types "/" at the start of a line or after a space. */
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
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashMenuKey,
        char: '/',
        allow: ({ state, range }) =>
          !state.doc.resolve(range.from).parent.type.spec.code && store.dismissedAt !== range.from,
        items: ({ query }) => store.find(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
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

  onUpdate() {
    // Forget a dismissed "/" once it has been deleted.
    const { store } = this.options;
    if (!store || store.dismissedAt === null) return;
    const { doc } = this.editor.state;
    const at = store.dismissedAt;
    if (at >= doc.content.size || doc.textBetween(at, at + 1) !== '/') store.dismissedAt = null;
  },
});
