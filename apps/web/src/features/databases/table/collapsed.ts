import { useState } from 'react';
import type { Id } from '@carehub/databases';

/** Where a person's collapsed groups in a view are kept (on this device). */
export const collapsedStorageKey = (databaseId: Id, viewId: Id, userId: Id) =>
  `carehub.databases.collapsed:${databaseId}:${viewId}:${userId}`;

function read(key: string): ReadonlySet<string> {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(key: string, keys: ReadonlySet<string>) {
  try {
    if (keys.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...keys]));
  } catch {
    // Storage can be full or turned off; the groups still collapse until the page closes.
  }
}

/**
 * The groups a person collapsed (QueryGroup.collapsedKey), remembered per person and view.
 * Returns them and a toggle.
 */
export function useCollapsedGroups(
  storageKey: string,
): [ReadonlySet<string>, (collapsedKey: string) => void] {
  const [state, setState] = useState(() => ({ storageKey, keys: read(storageKey) }));
  if (state.storageKey !== storageKey) setState({ storageKey, keys: read(storageKey) });
  const toggle = (collapsedKey: string) => {
    const keys = new Set(state.keys);
    if (keys.has(collapsedKey)) keys.delete(collapsedKey);
    else keys.add(collapsedKey);
    write(storageKey, keys);
    setState({ storageKey, keys });
  };
  return [state.storageKey === storageKey ? state.keys : read(storageKey), toggle];
}
