import { Outlet } from 'react-router';
import { AppShell } from '../features/shell/app-shell';
import { slots } from '../slots';

/** The app shell around every signed-in screen, with the sidebar items and sections from slots. */
export function AppLayout() {
  return (
    <AppShell items={slots.sidebarItems} sections={slots.sidebarSections}>
      <Outlet />
    </AppShell>
  );
}
