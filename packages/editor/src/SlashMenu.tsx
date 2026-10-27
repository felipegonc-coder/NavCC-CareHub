import type { Editor } from '@tiptap/core';
import { useEffect, useId, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { groupOf, type SlashMenuStore } from './slash';
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
  const optionId = (index: number) => `${listId}-${index}`;
  const activeId = state && state.items.length > 0 ? optionId(state.index) : null;

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
    <div className="ch-slash-menu" style={position(state.rect)}>
      {count === 0 ? (
        <p className="ch-slash-empty">No results</p>
      ) : (
        <div role="listbox" id={listId} aria-label="Insert a block">
          {sections(state.items).map(({ group, start, items }) => (
            <div key={group} role="group" aria-labelledby={`${listId}-group-${start}`}>
              <div id={`${listId}-group-${start}`} className="ch-slash-group">
                {group}
              </div>
              {items.map((item, offset) => {
                const index = start + offset;
                return (
                  <div
                    key={item.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === state.index}
                    tabIndex={-1}
                    className="ch-slash-option"
                    onMouseMove={() => store.setIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      store.select(item);
                    }}
                  >
                    <span className="ch-slash-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="ch-slash-text">
                      <span className="ch-slash-title">{item.title}</span>
                      {item.description && (
                        <span className="ch-slash-description">{item.description}</span>
                      )}
                    </span>
                    {item.hint && (
                      <span className="ch-slash-hint" aria-hidden="true">
                        {item.hint}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <span className="ch-sr-only" role="status">
        {count === 1 ? '1 result' : `${count} results`}
      </span>
    </div>,
    document.body,
  );
}
