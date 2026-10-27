import { Outlet } from 'react-router';

/** Stand-in around every signed-in screen; the app shell PR replaces it. */
export function AppLayout() {
  return <Outlet />;
}
