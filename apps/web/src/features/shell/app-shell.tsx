import { cn, Dialog, DialogTrigger, IconButton, SheetContent, useMediaQuery } from '@carehub/ui';
import { Menu } from 'lucide-react';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { HeaderTargetContext } from './header-context';
import { ShellSidebar } from './sidebar';
import type { SidebarItem, SidebarSection } from './types';

/** Tailwind's `md`: the sidebar is fixed from here up, and a slide-in menu below. */
const DESKTOP = '(min-width: 768px)';

function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('main-content')?.focus();
}

export interface AppShellProps {
  items: readonly SidebarItem[];
  sections: readonly SidebarSection[];
  children: ReactNode;
}

/**
 * The signed-in frame: the sidebar (a slide-in menu under 768 px), a top bar that screens fill
 * with <ShellHeader>, and the screen, which renders its own <main>.
 */
export function AppShell({ items, sections, children }: AppShellProps) {
  const { pathname } = useLocation();
  const desktop = useMediaQuery(DESKTOP);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  // The phone menu remembers the path it opened on: going anywhere else, or growing to desktop
  // width, closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = !desktop && menuPath === pathname;
  if (menuPath !== null && !menuOpen) setMenuPath(null);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main-content"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-bg focus:px-3 focus:py-2 focus:text-small focus:shadow-menu"
      >
        Skip to main content
      </a>
      {desktop && (
        <div className="fixed inset-y-0 left-0 z-20 flex w-sidebar border-r bg-sidebar">
          <ShellSidebar items={items} sections={sections} />
        </div>
      )}
      <Dialog open={menuOpen} onOpenChange={(open: boolean) => setMenuPath(open ? pathname : null)}>
        <div className={cn('flex min-h-dvh flex-col', desktop && 'pl-sidebar')}>
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-bg px-3 max-md:h-14">
            {!desktop && (
              <DialogTrigger asChild>
                <IconButton label="Open menu">
                  <Menu aria-hidden />
                </IconButton>
              </DialogTrigger>
            )}
            <div ref={setHeaderTarget} className="flex min-w-0 flex-1 items-center gap-2" />
          </header>
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
            <HeaderTargetContext.Provider value={headerTarget}>
              {children}
            </HeaderTargetContext.Provider>
          </div>
        </div>
        <SheetContent title="Menu" closeLabel="Close menu" className="bg-sidebar">
          <ShellSidebar items={items} sections={sections} onNavigate={() => setMenuPath(null)} />
        </SheetContent>
      </Dialog>
    </div>
  );
}
