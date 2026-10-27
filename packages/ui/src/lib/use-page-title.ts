import { useEffect } from 'react';

/** Sets the browser tab title: usePageTitle('Messages') shows "Care Hub · Messages". */
export function usePageTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `Care Hub · ${title}` : 'Care Hub';
  }, [title]);
}
