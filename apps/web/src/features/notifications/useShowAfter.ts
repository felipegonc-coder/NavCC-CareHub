import { useEffect, useState } from 'react';

/** True once `active` has lasted `delay` ms, so a quick load doesn't flash a skeleton. */
export function useShowAfter(active: boolean, delay = 300): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setShown(true), delay);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [active, delay]);
  return active && shown;
}
