import { useCallback, useState } from 'react';
import type { Id } from '@carehub/databases';

/** Where the groups a person collapsed in a view are kept, on this device (as the table does). */
const storageKey = (databaseId: Id, viewId: Id, userId: Id) =>
  `carehub.databases.collapsed:${databaseId}:${viewId}:${userId}`;

function load(key: string): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return new Set(
      Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function keep(key: string, keys: ReadonlySet<string>) {
  try {
    if (keys.size > 0) window.localStorage.setItem(key, JSON.stringify([...keys]));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be off or full: the groups stay collapsed until the page closes.
  }
}

/** The collapsed groups (QueryGroup.collapsedKey) of this person in this view, and a toggle. */
export function useCollapsed(
  databaseId: Id,
  viewId: Id,
  userId: Id,
): [ReadonlySet<string>, (collapsedKey: string) => void] {
  const key = storageKey(databaseId, viewId, userId);
  const [state, setState] = useState(() => ({ key, keys: load(key) }));
  const keys = state.key === key ? state.keys : load(key);
  const toggle = useCallback(
    (collapsedKey: string) => {
      const next = new Set(keys);
      if (!next.delete(collapsedKey)) next.add(collapsedKey);
      keep(key, next);
      setState({ key, keys: next });
    },
    [key, keys],
  );
  return [keys, toggle];
}
