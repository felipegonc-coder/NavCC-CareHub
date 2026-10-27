import type { Editor } from '@tiptap/core';
import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { groupOf, type SlashMenuStore } from './slash';
import type { SlashItem } from './types';

/** Space between the menu and the "/", and the least space between the menu and a screen edge. */
const GAP = 4;
const EDGE = 8;

/** A part of the window, in the coordinates that `position: fixed` uses. */
export interface Area {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Viewport = Pick<VisualViewport, 'offsetLeft' | 'offsetTop' | 'width' | 'height'>;

/** The part of the page you can see: with the on-screen keyboard open, the part above it. */
export function visibleArea(view: Viewport | null = window.visualViewport): Area {
  if (!view) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return { left: view.offsetLeft, top: view.offsetTop, width: view.width, height: view.height };
}

/**
 * Where the menu goes for the "/" at `caret`, inside `area`. It opens below the "/" if it fits
 * there at its tallest (`maxHeight`), otherwise on the side with more room, and is never taller
 * than that room. It stays at least EDGE px from the left and right edges, so on a phone it
 * stays on screen (in an area narrower than the menu, it keeps to the left).
 */
export function placeMenu(
  caret: { left: number; top: number; bottom: number },
  menu: { width: number; height: number; maxHeight: number },
  area: Area,
): { left: number; top: number; maxHeight: number } {
  const right = area.left + area.width - menu.width - EDGE;
  const left = Math.max(area.left + EDGE, Math.min(caret.left, right));
  const below = area.top + area.height - EDGE - (caret.bottom + GAP);
  const above = caret.top - GAP - (area.top + EDGE);
  const down = below >= menu.maxHeight || below >= above;
  const maxHeight = Math.max(0, Math.min(menu.maxHeight, down ? below : above));
  const top = down ? caret.bottom + GAP : caret.top - GAP - Math.min(menu.height, maxHeight);
  return { left, top, maxHeight };
}

/** Puts `menu` next to the "/" at `caret`, measuring its width and tallest height from its CSS. */
function placeAt(menu: HTMLElement, caret: DOMRect) {
  menu.style.maxHeight = '';
  const height = menu.offsetHeight;
  const tallest = Number.parseFloat(getComputedStyle(menu).maxHeight);
  const spot = placeMenu(
    caret,
    { width: menu.offsetWidth, height, maxHeight: Number.isNaN(tallest) ? height : tallest },
    visibleArea(),
  );
  menu.style.left = `${spot.left}px`;
  menu.style.top = `${spot.top}px`;
  menu.style.maxHeight = `${spot.maxHeight}px`;
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
  const menuRef = useRef<HTMLDivElement>(null);
  const rect = state?.rect ?? null;
  const count = state?.items.length ?? 0;

  // Placed before the browser paints, and again when the visible part of the page changes (the
  // on-screen keyboard opens, or the page scrolls under it).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const view = window.visualViewport;
    if (!menu || !rect) return;
    const place = () => placeAt(menu, rect);
    place();
    view?.addEventListener('resize', place);
    view?.addEventListener('scroll', place);
    return () => {
      view?.removeEventListener('resize', place);
      view?.removeEventListener('scroll', place);
    };
  }, [rect, count]);

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

  return createPortal(
    <div ref={menuRef} className="ch-slash-menu">
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
