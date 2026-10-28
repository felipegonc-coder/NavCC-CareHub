/**
 * Search in the toolbar (spec 3.2): it matches titles, text, links, emails, phones, option names
 * and people's names, ignoring case and accents (the server does the matching). It belongs to the
 * view showing and is never saved: another view starts without it.
 */
import { useEffect, useState } from 'react';
import type { Id } from '@carehub/databases';
import { SEARCH_DELAY_MS } from './tools';

export interface Search {
  /** The search box shows. */
  open: boolean;
  /** What's typed. */
  text: string;
  /** What the rows are searched for: the text once typing stops, trimmed. */
  query: string;
  /** Shows the box. */
  show(): void;
  type(text: string): void;
  /** Empties and hides the box, and the rows show without search at once. */
  clear(): void;
}

interface SearchState {
  viewId: Id;
  open: boolean;
  text: string;
  query: string;
}

export function useSearch(viewId: Id): Search {
  const [state, setState] = useState<SearchState | null>(null);
  const mine = state?.viewId === viewId ? state : null;
  const text = mine?.text ?? '';
  const query = mine?.query ?? '';
  const waiting = mine !== null && mine.text.trim() !== mine.query;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setState((s) => (s && s.viewId === viewId ? { ...s, query: s.text.trim() } : s));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting, text, viewId]);

  return {
    open: mine?.open ?? false,
    text,
    query,
    show: () => setState({ viewId, open: true, text, query }),
    // Emptied by hand, the rows come back without waiting.
    type: (next) =>
      setState({ viewId, open: true, text: next, query: next.trim() === '' ? '' : query }),
    clear: () => setState(null),
  };
}
