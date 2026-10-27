import { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * Set when a settings panel closes with Escape: what's typed in its fields is dropped. Otherwise
 * (a press outside, Tab away) it's saved.
 */
export const DiscardDrafts = createContext<{ current: boolean }>({ current: false });

/** A text setting being typed: shown in its field until it's saved or dropped. */
export interface Draft {
  value: string;
  error: string | null;
  change: (text: string) => void;
  /** Saves what's typed (Enter, leaving the field); false when it can't be saved. */
  commit: () => boolean;
}

/**
 * Typing in a settings field. `apply` checks the text and saves it when it changed, and returns
 * the problem (or null); it runs on commit, and when the field goes away with typing in it.
 */
export function useDraft(saved: string, apply: (text: string) => string | null): Draft {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const discard = useContext(DiscardDrafts);
  const latest = useRef({ text, apply });
  latest.current = { text, apply };

  useEffect(
    () => () => {
      const { text: typed, apply: save } = latest.current;
      if (typed !== null && !discard.current) save(typed);
    },
    [discard],
  );

  return {
    value: text ?? saved,
    error,
    change: (next) => {
      setText(next);
      setError(null);
    },
    commit: () => {
      if (text === null) return true;
      const problem = apply(text);
      setError(problem);
      if (problem) return false;
      setText(null);
      return true;
    },
  };
}
