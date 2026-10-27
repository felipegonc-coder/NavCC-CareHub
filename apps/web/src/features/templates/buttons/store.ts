// Between the "/" menu, which makes a button, and its block: the new button's settings open
// once its block is on the page. Problems the menu can't show itself go to the overlay's toast.
import { useSyncExternalStore } from 'react';

let wanted: string | null = null;
let problem: { id: number; message: string } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const emit = () => listeners.forEach((listener) => listener());

/** Opens the settings of this button when its block appears. */
export function openSettingsFor(buttonId: string) {
  wanted = buttonId;
  emit();
}

/** The block opened them. */
export function settingsOpened(buttonId: string) {
  if (wanted !== buttonId) return;
  wanted = null;
  emit();
}

export function useSettingsWanted(buttonId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => wanted === buttonId,
    () => false,
  );
}

/** Shown as a toast by `ButtonProblems`. */
export function reportProblem(message: string) {
  problem = { id: (problem?.id ?? 0) + 1, message };
  emit();
}

export function useProblem() {
  return useSyncExternalStore(
    subscribe,
    () => problem,
    () => null,
  );
}

// The "/" menu adds a block without a button; its view makes the button on the server, since it
// knows the page. Only the block added just now in that editor does.
const adding = new WeakMap<object, number>();

export function markAdding(editor: object) {
  adding.set(editor, Date.now());
}

export function takeAdding(editor: object): boolean {
  const at = adding.get(editor);
  adding.delete(editor);
  return at !== undefined && Date.now() - at < 5000;
}
