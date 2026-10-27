import { Kbd, sidebarRowClasses } from '@carehub/ui';
import { Search } from 'lucide-react';
import { shortcutLabel } from './keys';
import { openSearch } from './open';

/** Search at the top of the sidebar's sections; opens the same window as Ctrl+K. */
export function SidebarSearch() {
  return (
    <button type="button" className={sidebarRowClasses()} onClick={openSearch}>
      <Search aria-hidden className="size-4" />
      <span className="truncate">Search</span>
      <Kbd aria-hidden className="ml-auto max-md:hidden">
        {shortcutLabel(navigator.userAgent)}
      </Kbd>
    </button>
  );
}
