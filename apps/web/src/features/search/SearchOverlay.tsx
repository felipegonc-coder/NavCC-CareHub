import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router';
import { reportVisit } from './data';
import { isSearchShortcut } from './keys';
import { closeSearch, openSearch, useSearchOpen } from './open';

const loadWindow = () => import('./SearchWindow');
const SearchWindow = lazy(loadWindow);

const PAGE_PATH = /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/**
 * Search's overlay in the shell: Ctrl+K and Ctrl+P open the search window from any screen. The
 * editor handles Ctrl+K first when text is selected (the link editor), so a key it has already
 * used is left alone.
 */
export function SearchOverlay() {
  const open = useSearchOpen();
  const { pathname } = useLocation();
  const pageId = PAGE_PATH.exec(pathname)?.[1];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSearchShortcut(event)) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    // Loaded ahead, so the window opens at once and typing goes straight into it.
    const idle = setTimeout(() => void loadWindow().catch(() => {}), 1000);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(idle);
    };
  }, []);

  useEffect(() => {
    if (pageId) reportVisit(pageId);
  }, [pageId]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SearchWindow onClose={closeSearch} />
    </Suspense>
  );
}
