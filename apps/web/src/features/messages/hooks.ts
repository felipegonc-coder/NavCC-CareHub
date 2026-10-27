import { useEffect, useState } from 'react';

/** False until `ms` have passed since the component appeared: loading rows don't flash. */
export function useAfter(ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return done;
}

const tabVisible = () => document.visibilityState === 'visible';

/** Whether the tab is in front. */
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(tabVisible);
  useEffect(() => {
    const update = () => setVisible(tabVisible());
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
