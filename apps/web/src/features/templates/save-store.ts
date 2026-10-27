import { useSyncExternalStore } from 'react';
import type { SavedPage } from './save-dialog';

// The page menu's "Save as template" runs outside React (slots.ts), so it asks the templates
// overlay to open the dialog through this small store. The overlay also notes whether the person
// may save templates (the gallery's `canSave`), which decides if the menu item shows.

let request: SavedPage | null = null;
let allowed = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/** Opens Save as template for this page. */
export function openSaveAsTemplate(page: SavedPage) {
  request = { id: page.id, title: page.title };
  emit();
}

export function closeSaveAsTemplate() {
  request = null;
  emit();
}

/** The page Save as template is open for, if any. */
export function useSaveRequest(): SavedPage | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}

/** Whether the person may save templates (false until the gallery says so). */
export const saveAllowed = () => allowed;

export function setSaveAllowed(value: boolean) {
  allowed = value;
}
