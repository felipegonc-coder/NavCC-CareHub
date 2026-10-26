import type { Editor } from '@tiptap/core';
import { useEffect, useId, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { groupOf, markdownHint } from './blocks';
import type { SlashMenuStore } from './slash';
import type { SlashItem } from './types';

const MENU_HEIGHT = 320;

function position(rect: DOMRect | null): CSSProperties {
  if (!rect) return { left: 0, top: 0 };
  const below = rect.bottom + MENU_HEIGHT + 8 <= window.innerHeight || rect.top < MENU_HEIGHT;
  return below
    ? { left: rect.left, top: rect.bottom + 4 }
    : { left: rect.left, bottom: window.innerHeight - rect.top + 4 };
}

/** Consecutive entries of the same group (the store already keeps groups together). */
function sections(items: SlashItem[]) {
  const out: { group: string; start: number; items: SlashItem[] }[] = [];
  items.forEach((item, index) => {
    const last = out[out.length - 1];
    if (last?.group === groupOf(item)) last.items.push(item);
    else out.push({ group: groupOf(item), start: index, items: [item] });
  });
  return out;
}

/** The "/" menu: a listbox the editor controls through aria-activedescendant. */
export function SlashMenu({ editor, store }: { editor: Editor; store: SlashMenuStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const listId = `${useId()}slash`;
  const optionId = (index: number, item: SlashItem) =>
    `${listId}-${index}-${item.id.replace(/[^\w-]/g, '_')}`;
  const active = state?.items[state.index];
  const activeId = active && state ? optionId(state.index, active) : null;

  useEffect(() => {
    if (!activeId) return;
    const dom = editor.view.dom;
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-activedescendant', activeId);
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    return () => {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
    };
  }, [editor, listId, activeId]);

  if (!state) return null;
  const count = state.items.length;

  return createPortal(
    <div
      className="fixed z-50 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-bg p-1 text-fg shadow-menu"
      style={position(state.rect)}
    >
      {count === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted">No results</p>
      ) : (
        <div role="listbox" id={listId} aria-label="Insert a block">
          {sections(state.items).map(({ group, start, items }) => (
            <div key={group} role="group" aria-labelledby={`${listId}-group-${start}`}>
              <div id={`${listId}-group-${start}`} className="px-2 pb-1 pt-2 text-xs text-muted">
                {group}
              </div>
              {items.map((item, offset) => {
                const index = start + offset;
                const hint = markdownHint(item);
                return (
                  <div
                    key={item.id}
                    id={optionId(index, item)}
                    role="option"
                    aria-selected={index === state.index}
                    tabIndex={-1}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 aria-selected:bg-fill-hover"
                    onMouseMove={() => store.setIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      store.select(item);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border bg-bg"
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.title}</span>
                      {item.description && (
                        <span className="block truncate text-xs text-muted">
                          {item.description}
                        </span>
                      )}
                    </span>
                    {hint && (
                      <span className="text-xs text-muted" aria-hidden="true">
                        {hint}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <span className="sr-only" role="status">
        {count === 1 ? '1 result' : `${count} results`}
      </span>
    </div>,
    document.body,
  );
}
