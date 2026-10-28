import { useLayoutEffect, useRef } from 'react';

/*
 * Where focus goes when a pop-up closes. Radix gives it back to the pop-up's trigger, but a
 * pop-up opened another way (from a menu item, by a shortcut, from code) has no trigger, so focus
 * would drop to the page body and a keyboard user would start again from the top. The kit
 * remembers the last few elements that had focus or were pressed; when closing loses focus, it
 * goes to the newest of them that is still on the page and can take it.
 */

const LIMIT = 10;
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"])';
const remembered: HTMLElement[] = [];
let listening = false;

function remember(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement) || target === document.body) return;
  const index = remembered.indexOf(target);
  if (index !== -1) remembered.splice(index, 1);
  remembered.push(target);
  if (remembered.length > LIMIT) remembered.shift();
}

function listen(): void {
  if (listening) return;
  listening = true;
  remember(document.activeElement);
  document.addEventListener('focusin', (event) => remember(event.target), true);
  // Safari doesn't focus a button that is clicked, so pressing one counts too.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target instanceof Element) remember(event.target.closest(FOCUSABLE));
    },
    true,
  );
}

function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/** If nothing has focus, focuses the newest remembered element that can still take it. */
function restoreFocus(): void {
  for (const element of [...remembered].reverse()) {
    if (!focusIsLost()) return;
    if (element.isConnected) element.focus();
  }
}

interface FocusReturnProps<E extends Event> {
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  onInteractOutside?: ((event: E) => void) | undefined;
}

/**
 * Handlers for a pop-up's Radix content that give focus back as above, after the content's own
 * `onCloseAutoFocus` and only if that didn't prevent the default. With
 * `keepFocusAfterOutsideClick` (menus and popovers), a click outside leaves focus where it landed.
 */
export function useFocusReturn<E extends Event>(
  { onCloseAutoFocus, onInteractOutside }: FocusReturnProps<E>,
  { keepFocusAfterOutsideClick = false }: { keepFocusAfterOutsideClick?: boolean } = {},
) {
  const clickedOutside = useRef(false);
  // Before Radix's own effects move focus into a pop-up that has just mounted.
  useLayoutEffect(() => listen(), []);
  return {
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event);
      const keep = event.defaultPrevented || clickedOutside.current;
      clickedOutside.current = false;
      // Radix focuses the trigger after this handler, so look once it has had its turn.
      if (!keep) queueMicrotask(restoreFocus);
    },
    onInteractOutside(event: E) {
      onInteractOutside?.(event);
      if (keepFocusAfterOutsideClick && !event.defaultPrevented) clickedOutside.current = true;
    },
  };
}
