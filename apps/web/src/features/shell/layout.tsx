import { Outlet } from 'react-router';
import { AppShell } from './app-shell';
import { sidebarItems, sidebarSections } from './slot-source';

/** Lazy route module for the signed-in layout around the app's screens. */
export function Component() {
  return (
    <AppShell items={sidebarItems} sections={sidebarSections}>
      <Outlet />
    </AppShell>
  );
}
