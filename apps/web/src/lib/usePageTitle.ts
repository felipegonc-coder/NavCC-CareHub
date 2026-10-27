import { APP_NAME } from '@carehub/shared';
import { useEffect } from 'react';

/** Sets the document title: `usePageTitle('Messages')` gives "Care Hub · Messages", no title "Care Hub". */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${APP_NAME} · ${title}` : APP_NAME;
  }, [title]);
}
