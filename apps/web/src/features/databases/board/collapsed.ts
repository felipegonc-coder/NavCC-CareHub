import { useState } from 'react';
import type { Id } from '@carehub/databases';

/** Where a person's collapsed columns and lanes on a board are kept (on this device). */
export const collapsedKey = (databaseId: Id, viewId: Id, userId: Id) =>
  `carehub.databases.collapsed:${databaseId}:${viewId}:${userId}`;

/** Lanes are kept apart from columns, as a lane and a column can share a key. */
export const laneCollapsedKey = (key: string) => `lane:${key}`;

function read(storageKey: string): ReadonlySet<string> {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(storageKey: string, keys: ReadonlySet<string>) {
  try {
    if (keys.size === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Storage can be full or turned off: things still collapse until the page closes.
  }
}

/**
 * The columns and lanes a person collapsed (by collapsedKey), remembered per person and view.
 */
export function useCollapsed(storageKey: string): {
  collapsed: ReadonlySet<string>;
  toggle(key: string): void;
} {
  const [state, setState] = useState(() => ({ storageKey, keys: read(storageKey) }));
  const keys = state.storageKey === storageKey ? state.keys : read(storageKey);
  const toggle = (key: string) => {
    const next = new Set(keys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(storageKey, next);
    setState({ storageKey, keys: next });
  };
  return { collapsed: keys, toggle };
}
