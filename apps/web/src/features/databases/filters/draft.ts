import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Text that saves on Enter, when the field loses focus, and when the panel closes, so typing
 * doesn't save every letter.
 */
export function useDraft(saved: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setDraft(saved);
  }
  const latest = useRef({ draft, saved, commit });
  useEffect(() => {
    latest.current = { draft, saved, commit };
  });
  useEffect(
    () => () => {
      const last = latest.current;
      if (last.draft !== last.saved) last.commit(last.draft);
    },
    [],
  );
  const flush = () => {
    if (draft !== saved) commit(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      flush();
    }
  };
  return { draft, setDraft, flush, onKeyDown };
}
