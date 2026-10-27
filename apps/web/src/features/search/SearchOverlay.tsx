import { lazy, Suspense, useEffect } from 'react';
import { isSearchShortcut } from './keys';
import { closeSearch, openSearch, useSearchOpen } from './open';

const loadWindow = () => import('./SearchWindow');
const SearchWindow = lazy(loadWindow);

/**
 * Search's overlay in the shell: Ctrl+K and Ctrl+P open the search window from any screen. The
 * editor handles Ctrl+K first when text is selected (the link editor), so a key it has already
 * used is left alone.
 */
export function SearchOverlay() {
  const open = useSearchOpen();

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

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SearchWindow onClose={closeSearch} />
    </Suspense>
  );
}
