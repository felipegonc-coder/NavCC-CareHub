import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicStatus, StatusDetails } from './api';
import { routes } from './routes';

type Reply = () => Response;

const fetchMock = vi.fn<typeof fetch>();
/** The mocked API, by method and path. A missing route fails like a server that can't be reached. */
let replies: Record<string, Reply> = {};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const refuse =
  (status: number, code: string, message: string): Reply =>
  () =>
    json(status, { error: { code, message } });

/** September 27 to October 26: two days before installation, October 12 amber, the rest full. */
const days = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 8, 27 + index)).toISOString().slice(0, 10),
  percent: index < 2 ? null : index === 15 ? 99.2 : 100,
}));
const publicStatus: PublicStatus = { status: 'working', uptime: { percent: 99.9, days } };

const person = (isSiteAdmin: boolean) => ({
  user: {
    id: '5d0c2a4e-8f1b-4c3a-9e7d-2b6f1a0c9d31',
    email: isSiteAdmin ? 'avery.lin@example.com' : 'sam.ortiz@example.com',
    name: isSiteAdmin ? 'Avery Lin' : 'Sam Ortiz',
    avatarUrl: null,
    isSiteAdmin,
    timeZone: 'America/Denver',
    use24h: false,
    weekStart: 0,
    mustChangePassword: false,
  },
  member: null,
  workspace: null,
});

const details: StatusDetails = {
  parts: [
    { part: 'server', state: 'ok', message: null, facts: {}, checkedAt: '2026-10-26T16:00:00Z' },
    { part: 'database', state: 'ok', message: null, facts: {}, checkedAt: '2026-10-26T16:00:00Z' },
    {
      part: 'files',
      state: 'ok',
      message: null,
      facts: { freeBytes: 40_000_000_000, totalBytes: 100_000_000_000 },
      checkedAt: '2026-10-26T16:00:00Z',
    },
    ...(['collab', 'jobs'] as const).map((part) => ({
      part,
      state: 'unknown' as const,
      message: 'Not checked yet: this part comes later.',
      facts: {},
      checkedAt: '2026-10-26T16:00:00Z',
    })),
    {
      part: 'calendar',
      state: 'ok',
      message: null,
      facts: { connections: 3, failing: 1 },
      checkedAt: '2026-10-26T16:00:00Z',
    },
  ],
  backups: {
    setUp: true,
    lastGood: { at: '2026-10-26T08:00:00Z', sizeBytes: 1_200_000_000 },
    latest: { at: '2026-10-26T08:00:00Z', ok: true, reason: null },
    lastRestoreTest: { at: '2026-10-26T08:20:00Z', ok: true, details: null },
    next: '2026-10-27T08:00:00Z',
    requested: false,
  },
  incidents: [
    { start: '2026-10-18T14:20:00Z', end: '2026-10-18T14:25:00Z', minutes: 5, cause: 'update' },
  ],
  version: { number: '2.4.0', buildDate: null, updatedAt: '2026-10-18T14:25:00Z' },
};

function signInAsSiteAdmin(changes: Partial<StatusDetails> = {}) {
  replies['GET /api/auth/me'] = () => json(200, person(true));
  replies['GET /api/status/details'] = () => json(200, { ...details, ...changes });
}

function renderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: ['/status'] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The value next to a label in a details list. */
const valueOf = (label: string) => screen.getByText(label).nextElementSibling;

const requested = () =>
  fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${String(path)}`);

beforeEach(() => {
  replies = {
    'GET /api/auth/me': refuse(401, 'signed_out', 'Sign in to continue.'),
    'GET /api/status': () => json(200, publicStatus),
  };
  fetchMock.mockImplementation(async (path, init) => {
    const { pathname } = new URL(String(path), 'http://localhost');
    const reply = replies[`${init?.method ?? 'GET'} ${pathname}`];
    if (!reply) throw new TypeError('fetch failed');
    return reply();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('Status page', () => {
  it('ST-01: shows people who are signed out the overall status and 30 days of uptime only', async () => {
    renderStatus();

    // The word has its own element, and screen readers hear "Overall status: Working".
    expect((await screen.findByText('Working')).parentElement).toHaveTextContent(
      'Overall status: Working',
    );
    expect(screen.getByText('99.90% uptime in the last 30 days')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(['Status', 'Last 30 days']);
    const bars = within(screen.getByRole('group', { name: 'Uptime by day' })).getAllByRole(
      'button',
    );
    expect(bars).toHaveLength(30);
    expect(bars.map((bar) => bar.getAttribute('aria-label')).slice(0, 2)).toEqual([
      'September 27: no data',
      'September 28: no data',
    ]);
    expect(screen.queryByRole('button', { name: 'Back up now' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.title).toBe('Care Hub · Status');
    const timeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(requested()).toEqual(['GET /api/auth/me', `GET /api/status?tz=${timeZone}`]);
  });

  it('colours each day and reads it out on hover, on focus and with the arrow keys', async () => {
    renderStatus();
    const today = await screen.findByRole('button', { name: 'October 26: 100%' });
    const amber = screen.getByRole('button', { name: 'October 12: 99.2%' });
    const first = screen.getByRole('button', { name: 'September 27: no data' });
    expect(today).toHaveClass('bg-success');
    expect(amber).toHaveClass('bg-warning');
    expect(first).toHaveClass('bg-fill');
    // One tab stop for the 30 days, on today, which the readout shows to begin with.
    const group = screen.getByRole('group', { name: 'Uptime by day' });
    expect(
      within(group)
        .getAllByRole('button')
        .filter((bar) => bar.tabIndex === 0),
    ).toEqual([today]);
    expect(screen.getByText('October 26: 100%')).toBeInTheDocument();

    fireEvent.mouseEnter(amber);
    expect(screen.getByText('October 12: 99.2%')).toBeInTheDocument();
    fireEvent.mouseLeave(group);
    expect(screen.getByText('October 26: 100%')).toBeInTheDocument();

    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'Home' });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('September 27: no data')).toBeInTheDocument();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('button', { name: 'September 28: no data' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'End' });
    expect(today).toHaveFocus();
    fireEvent.keyDown(today, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'October 25: 100%' })).toHaveFocus();
    expect(screen.getByText('October 25: 100%')).toBeInTheDocument();
  });

  it("says when it can't reach the server, and Retry asks again", async () => {
    delete replies['GET /api/status'];
    renderStatus();

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the Care Hub server.");
    replies['GET /api/status'] = () => json(200, publicStatus);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Working')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ST-09: asks for fresh data every 30 seconds', async () => {
    const queryClient = renderStatus();
    await screen.findByText('Working');

    const query = queryClient.getQueryCache().find({ queryKey: ['status', 'public'] });
    expect(query?.observers.map((observer) => observer.options.refetchInterval)).toEqual([30_000]);
  });

  it('shows signed-in people who are not site admins what everyone sees', async () => {
    replies['GET /api/auth/me'] = () => json(200, person(false));
    renderStatus();

    expect(await screen.findByText('Working')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Backups' })).not.toBeInTheDocument();
    expect(requested()).not.toContain('GET /api/status/details');
    expect(requested()).toContain('GET /api/status?tz=America%2FDenver');
  });

  it('ST-02: shows site admins every part, backups, incidents and the version', async () => {
    signInAsSiteAdmin();
    renderStatus();

    expect(await screen.findByRole('heading', { level: 2, name: 'Parts' })).toBeInTheDocument();
    expect(await screen.findByText('99.90% uptime in the last 30 days')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Last 30 days', 'Parts', 'Backups', 'Incidents', 'Version']);

    expect(screen.getByText('Web app and server').closest('li')).toHaveTextContent('Working');
    expect(screen.getByText('File storage').closest('li')).toHaveTextContent(
      '40% of the disk free (40 GB of 100 GB).',
    );
    expect(screen.getAllByText('Not checked')).toHaveLength(2);
    expect(screen.getByText('Calendar sync').closest('li')).toHaveTextContent(
      '1 of 3 calendar connections failing.',
    );

    expect(valueOf('Last good backup')).toHaveTextContent('Oct 26, 2:00 AM · 1.2 GB');
    expect(valueOf('Last restore test')).toHaveTextContent('Passed on Oct 26, 2:20 AM');
    expect(valueOf('Next backup')).toHaveTextContent('Oct 27, 2:00 AM');
    expect(screen.getByText('Oct 18, 8:20 AM to Oct 18, 8:25 AM')).toBeInTheDocument();
    expect(screen.getByText('5 minutes · Update')).toBeInTheDocument();
    expect(valueOf('Number')).toHaveTextContent('2.4.0');
    expect(valueOf('Build date')).toHaveTextContent('Not recorded');
    expect(valueOf('Last update')).toHaveTextContent('Oct 18, 8:25 AM');
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test a restore now' })).toBeInTheDocument();
  });

  it('says when there are no backups yet', async () => {
    signInAsSiteAdmin({
      backups: { ...details.backups, lastGood: null, latest: null, lastRestoreTest: null },
      incidents: [],
    });
    renderStatus();

    expect(
      await screen.findByText('No backups yet. The first one runs tonight.'),
    ).toBeInTheDocument();
    expect(valueOf('Last good backup')).toHaveTextContent('None yet');
    expect(valueOf('Last restore test')).toHaveTextContent('None yet');
    expect(screen.getByText('No incidents in the last 30 days.')).toBeInTheDocument();
  });

  it("says when backups aren't set up, with no next backup", async () => {
    signInAsSiteAdmin({
      backups: {
        ...details.backups,
        setUp: false,
        lastGood: null,
        latest: null,
        lastRestoreTest: null,
      },
    });
    renderStatus();

    expect(await screen.findByText("Backups aren't set up on this server.")).toBeInTheDocument();
    expect(
      screen.queryByText('No backups yet. The first one runs tonight.'),
    ).not.toBeInTheDocument();
    expect(valueOf('Last good backup')).toHaveTextContent('None yet');
    expect(screen.queryByText('Next backup')).not.toBeInTheDocument();
  });

  it('ST-06: shows a failed backup with its reason', async () => {
    signInAsSiteAdmin({
      backups: {
        ...details.backups,
        latest: { at: '2026-10-27T08:00:00Z', ok: false, reason: 'The backup disk is full.' },
      },
    });
    renderStatus();

    expect(await screen.findByText('Latest backup')).toBeInTheDocument();
    expect(valueOf('Latest backup')).toHaveTextContent(
      'Failed on Oct 27, 2:00 AM: The backup disk is full.',
    );
    expect(valueOf('Last good backup')).toHaveTextContent('Oct 26, 2:00 AM · 1.2 GB');
  });

  it('ST-08: Back up now asks for a backup, and says so when one is already coming', async () => {
    signInAsSiteAdmin();
    replies['POST /api/status/backup'] = () => json(202, { requested: true });
    renderStatus();

    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect(
      await screen.findByText(
        'Backup asked for. It starts within a minute; the result shows here when it ends.',
      ),
    ).toBeInTheDocument();
    expect(requested()).toContain('POST /api/status/backup');

    replies['POST /api/status/backup'] = refuse(
      409,
      'conflict',
      'A backup was already asked for. It starts within a minute.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test a restore now' }));
    expect(
      await screen.findByText('A backup was already asked for. It starts within a minute.'),
    ).toBeInTheDocument();
  });
});
