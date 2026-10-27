import { ConnectedCalendars } from './ConnectedCalendars';

export { useRefreshOnOpen, useSyncConnection } from './data';

/** `/calendar/connections`: connect Google Calendar or calendar links, and look after them. */
export function ConnectionsScreen() {
  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg md:px-6 md:py-10">
      <title>Care Hub · Connected calendars</title>
      <h1 className="text-title">Connected calendars</h1>
      <ConnectedCalendars />
    </main>
  );
}
