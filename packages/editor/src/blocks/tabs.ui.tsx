import type { ResolvedPos } from '@tiptap/pm/model';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { PanelTop, Plus } from 'lucide-react';
import { createElement, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { NodeViews, SlashItem } from '../types';
import {
  cleanTabIcon,
  cleanTabName,
  MAX_TAB_NAME,
  MAX_TABS,
  openTabOf,
  TAB_LABEL_SIZES,
  tabKey,
} from './tabs';
import './tabs.css';

// The tabs group's "/" menu entries and React views. Rules in ./ui.ts.
export const slashItems: SlashItem[] = [
  {
    id: 'tabs',
    title: 'Tabs',
    description: 'Tabs that each hold their own blocks',
    icon: createElement(PanelTop, { size: 18 }),
    keywords: ['tab', 'sections'],
    group: 'Basic blocks',
    run: (editor) => {
      editor.chain().focus().insertTabs().run();
    },
  },
];

type ProseMirrorNode = ReactNodeViewProps['node'];

interface TabLabel {
  key: string | null;
  name: string;
  emoji: string | null;
}

function labelsOf(tabs: ProseMirrorNode): TabLabel[] {
  const labels: TabLabel[] = [];
  tabs.forEach((tab) => {
    const icon = cleanTabIcon(tab.attrs.icon);
    labels.push({
      key: tabKey(tab),
      name: cleanTabName(tab.attrs.name) || 'Untitled',
      emoji: icon?.type === 'emoji' ? icon.emoji : null,
    });
  });
  return labels;
}

/** Where the first line of text in a tab starts, from the start of the tab; null if none. */
function firstLine(tab: ProseMirrorNode): number | null {
  let found: number | null = null;
  tab.descendants((child, offset) => {
    if (found === null && child.isTextblock) found = offset + 2;
    return found === null;
  });
  return found;
}

/** Where the tab at `index` of the tabs block at `pos` starts. */
function tabStart(tabs: ProseMirrorNode, pos: number, index: number): number {
  let start = pos + 1;
  for (let i = 0; i < index; i += 1) start += tabs.child(i).nodeSize;
  return start;
}

/**
 * The index of the tab whose first line `$pos` is in, when the closest tabs block around it is
 * the one at `pos`; null if not.
 */
function firstLineOf($pos: ResolvedPos, pos: number): number | null {
  for (let depth = $pos.depth - 2; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name !== 'tabs') continue;
    if ($pos.before(depth) !== pos) return null;
    const line = firstLine($pos.node(depth + 1));
    const isFirst = line !== null && $pos.before(depth + 1) + line === $pos.start();
    return isFirst ? $pos.index(depth) : null;
  }
  return null;
}

/** The name field that takes a tab's place while it's renamed: Enter keeps it, Esc cancels. */
function RenameInput({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string | null, refocus: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null, refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(name, refocus);
  };
  return (
    <input
      ref={ref}
      className="ch-tab-rename"
      aria-label="Tab name"
      defaultValue={name}
      maxLength={MAX_TAB_NAME}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        finish(event.key === 'Enter' ? event.currentTarget.value : null, true);
      }}
      onBlur={(event) => finish(event.currentTarget.value, false)}
    />
  );
}

/**
 * A tabs block: a tab list over the open tab's blocks. Anyone can open tabs, also read-only;
 * editors add tabs with "+" and rename them with a double-click or F2. Arrows, Home and End
 * move between tabs; Down goes into the open tab, and Up on its first line comes back.
 */
function TabsView({ node, editor, getPos, decorations }: ReactNodeViewProps) {
  const { index: open, idPrefix } = openTabOf(decorations);
  const labels = labelsOf(node);
  const count = labels.length;
  const editable = editor.isEditable;
  const size = TAB_LABEL_SIZES.find((value) => value === node.attrs.labelSize) ?? 'default';
  const [renaming, setRenaming] = useState<number | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);

  // Focus goes to a tab once it's drawn, as after a rename.
  useEffect(() => {
    const button = focusNext.current === null ? null : buttons.current[focusNext.current];
    if (!button) return;
    button.focus();
    focusNext.current = null;
  });

  // The open tab scrolls into view in a row too long for the screen.
  useEffect(() => {
    const list = row.current;
    const tab = buttons.current[open];
    if (!list || !tab) return;
    if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft;
    const end = tab.offsetLeft + tab.offsetWidth - list.clientWidth;
    if (end > list.scrollLeft) list.scrollLeft = end;
  }, [open]);

  // Up on the top line of a tab's first line goes to the tab. The editor takes its keys on its
  // own element, so this listens on the element around it, before the editor.
  useEffect(() => {
    const { view } = editor;
    const around = view.dom.parentElement;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const pos = getPos();
      const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
      if (event.key !== 'ArrowUp' || modified || event.target !== view.dom) return;
      const { empty, $from } = view.state.selection;
      const index = empty && typeof pos === 'number' ? firstLineOf($from, pos) : null;
      const tab = index === null ? null : buttons.current[index];
      if (!tab || !view.endOfTextblock('up')) return;
      event.preventDefault();
      event.stopPropagation();
      tab.focus();
    };
    around?.addEventListener('keydown', onKeyDown, true);
    return () => around?.removeEventListener('keydown', onKeyDown, true);
  }, [editor, getPos]);

  const at = () => {
    const pos = getPos();
    return typeof pos === 'number' ? pos : null;
  };
  /** The block's position when you may change it: only editors change tabs. */
  const editAt = () => (editor.isEditable ? at() : null);

  const select = (index: number) => {
    const pos = at();
    if (pos !== null) editor.commands.openTab(pos, index);
  };

  /** Opens the tab at `index` with the cursor at the start of its first line. */
  const enter = (index: number) => {
    const pos = editAt();
    if (pos === null) return;
    const line = firstLine(node.child(index));
    const chain = editor.chain().openTab(pos, index);
    chain.focus(line === null ? null : tabStart(node, pos, index) + line).run();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const last = count - 1;
    const moves: Record<string, number> = {
      ArrowLeft: index > 0 ? index - 1 : last,
      ArrowRight: index < last ? index + 1 : 0,
      Home: 0,
      End: last,
    };
    const to = moves[event.key];
    if (to !== undefined) {
      select(to);
      buttons.current[to]?.focus();
    } else if (event.key === 'ArrowDown' && editable) enter(index);
    else if (event.key === 'F2' && editable) setRenaming(index);
    else return;
    event.preventDefault();
  };

  return (
    <NodeViewWrapper className="ch-tabs" data-label-size={size === 'default' ? undefined : size}>
      <div className="ch-tabs-bar" contentEditable={false} suppressContentEditableWarning>
        <div ref={row} role="tablist" aria-label="Tabs" className="ch-tabs-row">
          {labels.map((label, index) =>
            index === renaming ? (
              <RenameInput
                key={`rename-${index}`}
                name={cleanTabName(node.child(index).attrs.name)}
                onDone={(name, refocus) => {
                  const pos = editAt();
                  if (name !== null && pos !== null) editor.commands.renameTab(pos, index, name);
                  if (refocus) focusNext.current = index;
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                key={`${index}:${label.key ?? ''}`}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                role="tab"
                id={label.key === null ? undefined : `${idPrefix}-tab-${label.key}`}
                aria-controls={label.key === null ? undefined : `${idPrefix}-panel-${label.key}`}
                aria-selected={index === open}
                tabIndex={index === open ? 0 : -1}
                className="ch-tab"
                onClick={() => select(index)}
                onDoubleClick={() => {
                  if (editable) setRenaming(index);
                }}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {label.emoji && (
                  <span className="ch-tab-icon" aria-hidden="true">
                    {label.emoji}
                  </span>
                )}
                <span className="ch-tab-name">{label.name}</span>
              </button>
            ),
          )}
        </div>
        {editable && count < MAX_TABS && (
          <button
            type="button"
            className="ch-tabs-add"
            aria-label="Add a tab"
            title="Add a tab"
            onClick={() => {
              const pos = editAt();
              if (pos !== null) editor.chain().focus().addTab(pos).run();
            }}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <NodeViewContent className="ch-tabs-content" />
    </NodeViewWrapper>
  );
}

/** The editor leaves events in the tab row to the view. */
const stopEvent = (event: Event) =>
  event.target instanceof Element && event.target.closest('.ch-tabs-bar') !== null;

export const nodeViews: NodeViews = { tabs: { component: TabsView, stopEvent } };
