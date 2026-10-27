import { pageUrl } from '@carehub/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsScreen } from './analytics-screen';
import type { Filters, Overview } from './api';

type Reply = () => Response | Promise<Response>;

const fetchMock = vi.fn<typeof fetch>();
/** The mocked API, by path. A missing path fails like a server that can't be reached. */
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

/** A reply that waits until the test lets it go. */
function held(body: unknown) {
  let release = () => {};
  const response = new Promise<Response>((resolve) => {
    release = () => resolve(json(200, body));
  });
  return { reply: () => response, release: () => release() };
}

const ids = {
  refund: '1b6d7c1e-2f3a-4b5c-8d6e-7f8091a2b3c4',
  handover: '2c7e8d2f-3a4b-4c6d-9e7f-8091a2b3c4d5',
  rota: '3d8f9e3a-4b5c-4d7e-8f80-91a2b3c4d5e6',
  onboarding: '4e9a0f4b-5c6d-4e8f-9091-a2b3c4d5e6f7',
  untitled: '5f0b1a5c-6d7e-4f90-a1b2-c3d4e5f60718',
  avery: '6a1c2b6d-7e8f-4a01-b2c3-d4e5f6071829',
  sam: '7b2d3c7e-8f90-4b12-93d4-e5f60718293a',
  riley: '8c3e4d8f-9001-4c23-a4e5-f60718293a4b',
  jordan: '9d4f5e90-0a12-4d34-b5f6-0718293a4b5c',
  clinic: 'ae5a6fa1-1b23-4e45-8607-18293a4b5c6d',
  desk: 'bf6b70b2-2c34-4f56-9718-293a4b5c6d7e',
};

const DAYS = [
  ['2026-10-21', 3, 12, 3, 1],
  ['2026-10-22', 4, 15, 5, 0],
  ['2026-10-23', 2, 8, 1, 0],
  ['2026-10-24', 0, 0, 0, 0],
  ['2026-10-25', 1, 2, 0, 0],
  ['2026-10-26', 5, 20, 7, 2],
  ['2026-10-27', 3, 9, 2, 1],
] as const;

/** The last 7 days for an Admin in Denver. */
const overview: Overview = {
  range: { from: '2026-10-21', to: '2026-10-27' },
  keptFrom: '2025-10-28',
  timeZone: 'America/Denver',
  totals: { activePeople: 6, views: 66, edits: 18, created: 4 },
  days: DAYS.map(([day, activePeople, views, edits, created]) => ({
    day,
    activePeople,
    views,
    edits,
    created,
  })),
  topPages: [
    { pageId: ids.refund, title: 'Refund policy', state: 'live', views: 24, viewers: 5 },
    { pageId: ids.handover, title: 'Shift handover notes', state: 'live', views: 18, viewers: 4 },
    { pageId: ids.rota, title: 'Old rota', state: 'deleted', views: 9, viewers: 3 },
    { pageId: ids.onboarding, title: 'Onboarding checklist', state: 'trash', views: 7, viewers: 2 },
    { pageId: ids.untitled, title: '', state: 'live', views: 4, viewers: 1 },
  ],
  topEditors: [
    { userId: ids.avery, name: 'Avery Lin', edits: 8 },
    { userId: ids.sam, name: 'Sam Ortiz', edits: 5 },
    { userId: ids.riley, name: 'Riley Chen', edits: 3 },
    { userId: ids.jordan, name: 'Jordan Patel', edits: 2 },
  ],
};

const quiet: Overview = {
  ...overview,
  totals: { activePeople: 0, views: 0, edits: 0, created: 0 },
  days: overview.days.map(({ day }) => ({ day, activePeople: 0, views: 0, edits: 0, created: 0 })),
  topPages: [],
  topEditors: [],
};

const filters: Filters = {
  people: [
    { id: ids.avery, name: 'Avery Lin' },
    { id: ids.jordan, name: 'Jordan Patel' },
    { id: ids.riley, name: 'Riley Chen' },
    { id: ids.sam, name: 'Sam Ortiz' },
  ],
  spaces: [
    { id: ids.clinic, name: 'Clinical team' },
    { id: ids.desk, name: 'Front desk' },
  ],
};

function renderAnalytics(path = '/analytics') {
  // Retries happen at once, so a failing request gives up quickly; nothing is garbage collected
  // after the test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  // The screen itself, not the lazy route (routes.test.ts), so loading it isn't timed.
  const router = createMemoryRouter([{ path: '/analytics', Component: AnalyticsScreen }], {
    initialEntries: [path],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Each request as "GET <path and query>". */
const requested = () =>
  fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${String(path)}`);
const overviewRequests = () =>
  requested().filter((request) => request.startsWith('GET /api/analytics/overview'));

/** The text of each cell, row by row, header first. */
const cells = (table: HTMLElement) =>
  Array.from(table.querySelectorAll('tr'), (row) =>
    Array.from(row.children, (cell) => cell.textContent ?? ''),
  );

/** Opens a design kit Select from the keyboard and picks an option, as a keyboard user would. */
async function choose(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
}

const readBytes = (blob: Blob) =>
  new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // Only the date is fixed (12:00 in Denver on October 27, 2026); timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T18:00:00Z'));
  // jsdom has no layout: charts and the design kit's Select need these to exist.
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};

  replies = {
    '/api/analytics/overview': () => json(200, overview),
    '/api/analytics/filters': () => json(200, filters),
  };
  fetchMock.mockImplementation(async (path) => {
    const { pathname } = new URL(String(path), 'http://localhost');
    const reply = replies[pathname];
    if (!reply) throw new TypeError('fetch failed');
    return reply();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('Analytics', () => {
  it('AN-04: shows the last 7 days by default, with the totals, charts and top 10 lists', async () => {
    renderAnalytics();

    const totals = await screen.findByTestId('analytics-totals');
    expect(within(totals).getByTestId('analytics-total-activePeople')).toHaveTextContent(
      /^Active people\s*6$/,
    );
    expect(within(totals).getByTestId('analytics-total-views')).toHaveTextContent(
      /^Page views\s*66$/,
    );
    expect(within(totals).getByTestId('analytics-total-edits')).toHaveTextContent(/^Edits\s*18$/);
    expect(within(totals).getByTestId('analytics-total-created')).toHaveTextContent(
      /^Pages created\s*4$/,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.title).toBe('Care Hub · Analytics');
    expect(screen.getByTestId('analytics-range')).toHaveTextContent('Last 7 days');
    expect(screen.getByTestId('analytics-kept-note')).toHaveTextContent(
      'Activity older than 1 year is deleted. Analytics goes back to October 28, 2025. ' +
        'Days follow your time zone, America/Denver.',
    );
    expect(screen.getByTestId('analytics-chart-active-people')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-chart-views-edits')).toBeInTheDocument();

    const pages = screen.getByTestId('analytics-top-pages');
    expect(cells(pages)).toEqual([
      ['Page', 'Views', 'People who viewed'],
      ['Refund policy', '24', '5'],
      ['Shift handover notes', '18', '4'],
      ['Old rota (deleted)', '9', '3'],
      ['Onboarding checklist (in Trash)', '7', '2'],
      ['Untitled', '4', '1'],
    ]);
    expect(within(pages).getByRole('link', { name: 'Refund policy' })).toHaveAttribute(
      'href',
      pageUrl(ids.refund),
    );
    // Deleted pages keep their numbers, without a link.
    expect(within(pages).getAllByRole('link')).toHaveLength(3);
    expect(cells(screen.getByTestId('analytics-top-editors'))).toEqual([
      ['Person', 'Edits'],
      ['Avery Lin', '8'],
      ['Sam Ortiz', '5'],
      ['Riley Chen', '3'],
      ['Jordan Patel', '2'],
    ]);
    expect(requested()).toContain('GET /api/analytics/overview');
    expect(requested()).toContain('GET /api/analytics/filters');
  });

  it('shows skeletons while the numbers load', async () => {
    const slow = held(overview);
    replies['/api/analytics/overview'] = slow.reply;
    renderAnalytics();

    const loading = await screen.findByTestId('analytics-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveTextContent('Loading Analytics…');
    slow.release();
    expect(await screen.findByTestId('analytics-totals')).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-loading')).not.toBeInTheDocument();
  });

  it('reads 30 or 90 days and custom dates from the address', async () => {
    renderAnalytics('/analytics?days=30');
    await screen.findByTestId('analytics-totals');
    expect(screen.getByTestId('analytics-range')).toHaveTextContent('Last 30 days');
    expect(overviewRequests()).toEqual(['GET /api/analytics/overview?days=30']);
  });

  it('asks for custom dates within the kept year, up to today', async () => {
    renderAnalytics('/analytics?from=2026-10-01&to=2026-10-15');
    await screen.findByTestId('analytics-totals');
    expect(screen.getByTestId('analytics-range')).toHaveTextContent('Custom range');
    expect(overviewRequests()).toEqual([
      'GET /api/analytics/overview?from=2026-10-01&to=2026-10-15',
    ]);
    const range = screen.getByTestId('analytics-custom-range');
    const from = within(range).getByLabelText('From');
    const to = within(range).getByLabelText('To');
    expect(from).toHaveValue('2026-10-01');
    expect(to).toHaveValue('2026-10-15');
    expect(from).toHaveAttribute('min', '2025-10-28');
    expect(to).toHaveAttribute('max', '2026-10-27');

    fireEvent.change(from, { target: { value: '2025-10-01' } });
    expect(within(range).getByRole('alert')).toHaveTextContent(
      'Choose dates within the last year, up to today.',
    );
    expect(from).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(from, { target: { value: '2026-10-20' } });
    expect(within(range).getByRole('alert')).toHaveTextContent(
      'Choose a start date on or before the end date.',
    );
    expect(overviewRequests()).toHaveLength(1);

    fireEvent.change(from, { target: { value: '2026-10-08' } });
    expect(within(range).getByRole('alert')).toBeEmptyDOMElement();
    expect(from).not.toHaveAttribute('aria-invalid');
    await waitFor(() =>
      expect(overviewRequests()).toContain(
        'GET /api/analytics/overview?from=2026-10-08&to=2026-10-15',
      ),
    );
  });

  it('changes the range from the keyboard, keeping the old numbers dimmed until the new ones come', async () => {
    renderAnalytics();
    await screen.findByTestId('analytics-totals');
    const slow = held({ ...overview, range: { from: '2026-07-30', to: '2026-10-27' } });
    replies['/api/analytics/overview'] = slow.reply;

    await choose(screen.getByTestId('analytics-range'), 'Last 90 days');
    await waitFor(() =>
      expect(overviewRequests()).toContain('GET /api/analytics/overview?days=90'),
    );
    expect(screen.getByTestId('analytics-range')).toHaveTextContent('Last 90 days');
    const numbers = screen.getByTestId('analytics-totals').parentElement;
    expect(numbers).toHaveAttribute('aria-busy', 'true');
    slow.release();
    await waitFor(() => expect(numbers).toHaveAttribute('aria-busy', 'false'));
  });

  it('filters by space and person', async () => {
    renderAnalytics(`/analytics?space=${ids.clinic}`);
    await screen.findByTestId('analytics-totals');
    expect(overviewRequests()).toEqual([`GET /api/analytics/overview?space=${ids.clinic}`]);
    const space = screen.getByTestId('analytics-filter-space');
    const person = screen.getByTestId('analytics-filter-person');
    await waitFor(() => expect(space).toHaveTextContent('Clinical team'));
    expect(person).toHaveTextContent('Everyone');

    await choose(person, 'Sam Ortiz');
    await waitFor(() =>
      expect(overviewRequests()).toContain(
        `GET /api/analytics/overview?person=${ids.sam}&space=${ids.clinic}`,
      ),
    );
    await choose(space, 'All spaces');
    await waitFor(() =>
      expect(overviewRequests()).toContain(`GET /api/analytics/overview?person=${ids.sam}`),
    );
    expect(space).toHaveTextContent('All spaces');
    expect(person).toHaveTextContent('Sam Ortiz');
  });

  it('AN-10: every chart has View as table, with the same numbers', async () => {
    renderAnalytics();
    const active = await screen.findByTestId('analytics-chart-active-people');
    fireEvent.click(within(active).getByRole('button', { name: 'View as table' }));
    expect(cells(within(active).getByRole('table'))).toEqual([
      ['Day', 'Active people'],
      ['October 21, 2026', '3'],
      ['October 22, 2026', '4'],
      ['October 23, 2026', '2'],
      ['October 24, 2026', '0'],
      ['October 25, 2026', '1'],
      ['October 26, 2026', '5'],
      ['October 27, 2026', '3'],
    ]);

    const viewsEdits = screen.getByTestId('analytics-chart-views-edits');
    fireEvent.click(within(viewsEdits).getByRole('button', { name: 'View as table' }));
    expect(cells(within(viewsEdits).getByRole('table'))).toEqual([
      ['Day', 'Page views', 'Edits'],
      ['October 21, 2026', '12', '3'],
      ['October 22, 2026', '15', '5'],
      ['October 23, 2026', '8', '1'],
      ['October 24, 2026', '0', '0'],
      ['October 25, 2026', '2', '0'],
      ['October 26, 2026', '20', '7'],
      ['October 27, 2026', '9', '2'],
    ]);

    fireEvent.click(within(active).getByRole('button', { name: 'View as chart' }));
    expect(within(active).queryByRole('table')).not.toBeInTheDocument();
    expect(
      within(active).getByRole('slider', { name: 'Active people per day' }),
    ).toBeInTheDocument();
  });

  it('is a slider from the keyboard, saying each day as the keys move through a chart', async () => {
    renderAnalytics();
    const active = await screen.findByTestId('analytics-chart-active-people');
    const chart = within(active).getByRole('slider', { name: 'Active people per day' });
    const readout = screen.getByTestId('analytics-chart-active-people-readout');
    const says = (text: string) => {
      expect(chart).toHaveAttribute('aria-valuetext', text);
      expect(readout).toHaveTextContent(text);
    };
    expect(chart).toHaveAttribute('tabindex', '0');
    expect(chart).toHaveAccessibleDescription(
      'Use the left and right arrow keys to read each day.',
    );
    // The latest day, until another is chosen; shown on screen only while the chart has focus.
    expect(chart).toHaveAttribute('aria-valuetext', 'October 27, 2026: 3 active people');
    expect(chart).toHaveAttribute('aria-valuenow', '7');
    expect(readout).toBeEmptyDOMElement();

    fireEvent.focus(chart);
    says('October 27, 2026: 3 active people');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    says('October 26, 2026: 5 active people');
    expect(chart).toHaveAttribute('aria-valuenow', '6');
    fireEvent.keyDown(chart, { key: 'Home' });
    says('October 21, 2026: 3 active people');
    fireEvent.keyDown(chart, { key: 'ArrowDown' });
    says('October 21, 2026: 3 active people');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    says('October 22, 2026: 4 active people');
    fireEvent.keyDown(chart, { key: 'PageUp' });
    says('October 27, 2026: 3 active people');
    fireEvent.keyDown(chart, { key: 'ArrowUp' });
    says('October 27, 2026: 3 active people');
    fireEvent.keyDown(chart, { key: 'PageDown' });
    says('October 21, 2026: 3 active people');
    fireEvent.keyDown(chart, { key: 'End' });
    says('October 27, 2026: 3 active people');
    fireEvent.blur(chart);
    expect(readout).toBeEmptyDOMElement();

    const bars = within(screen.getByTestId('analytics-chart-views-edits')).getByRole('slider', {
      name: 'Views and edits per day',
    });
    fireEvent.focus(bars);
    fireEvent.keyDown(bars, { key: 'ArrowLeft' });
    expect(bars).toHaveAttribute('aria-valuetext', 'October 26, 2026: 20 views, 7 edits');
    expect(screen.getByTestId('analytics-chart-views-edits-readout')).toHaveTextContent(
      'October 26, 2026: 20 views, 7 edits',
    );
  });

  it('sorts a table by any column from its header button', async () => {
    renderAnalytics();
    const pages = await screen.findByTestId('analytics-top-pages');
    const names = () =>
      cells(pages)
        .slice(1)
        .map(([name]) => name);
    expect(within(pages).getByRole('columnheader', { name: 'Views' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    fireEvent.click(within(pages).getByRole('button', { name: 'Page' }));
    expect(names()).toEqual([
      'Old rota (deleted)',
      'Onboarding checklist (in Trash)',
      'Refund policy',
      'Shift handover notes',
      'Untitled',
    ]);
    expect(within(pages).getByRole('columnheader', { name: 'Page' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(within(pages).getByRole('columnheader', { name: 'Views' })).not.toHaveAttribute(
      'aria-sort',
    );
    fireEvent.click(within(pages).getByRole('button', { name: 'Page' }));
    expect(names()[0]).toBe('Untitled');
    fireEvent.click(within(pages).getByRole('button', { name: 'People who viewed' }));
    expect(
      cells(pages)
        .slice(1)
        .map((row) => row[2]),
    ).toEqual(['5', '4', '3', '2', '1']);
    fireEvent.click(within(pages).getByRole('button', { name: 'People who viewed' }));
    expect(
      cells(pages)
        .slice(1)
        .map((row) => row[2]),
    ).toEqual(['1', '2', '3', '4', '5']);
  });

  it('Export CSV saves the table as shown, as UTF-8', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:analytics-test');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const saved: { name: string; href: string }[] = [];
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof HTMLAnchorElement && event.target.download) {
        event.preventDefault();
        saved.push({ name: event.target.download, href: event.target.href });
      }
    };
    document.addEventListener('click', onClick);
    try {
      renderAnalytics();
      const editors = await screen.findByTestId('analytics-top-editors');
      fireEvent.click(within(editors).getByRole('button', { name: 'Person' }));
      fireEvent.click(within(editors).getByRole('button', { name: 'Export CSV of top editors' }));

      expect(saved).toEqual([
        { name: 'analytics-top-editors-2026-10-21-to-2026-10-27.csv', href: 'blob:analytics-test' },
      ]);
      const blob = createObjectURL.mock.calls[0]?.[0];
      expect(blob?.type).toBe('text/csv;charset=utf-8');
      const bytes = await readBytes(blob as Blob);
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(bytes.slice(3))).toBe(
        'Person,Edits\r\nAvery Lin,8\r\nJordan Patel,2\r\nRiley Chen,3\r\nSam Ortiz,5\r\n',
      );
    } finally {
      document.removeEventListener('click', onClick);
    }
  });

  it('says when there was no activity in the range', async () => {
    replies['/api/analytics/overview'] = () => json(200, quiet);
    renderAnalytics();

    expect(await screen.findByTestId('analytics-empty')).toHaveTextContent(
      'No activity in this range.',
    );
    expect(screen.queryByTestId('analytics-totals')).not.toBeInTheDocument();
    expect(screen.getByTestId('analytics-kept-note')).toHaveTextContent(
      'Activity older than 1 year is deleted.',
    );
  });

  it("AN-06: tells someone who isn't an Admin they don't have access, without Retry", async () => {
    replies['/api/analytics/overview'] = refuse(403, 'forbidden', "You don't have access to this.");
    replies['/api/analytics/filters'] = refuse(403, 'forbidden', "You don't have access to this.");
    renderAnalytics();

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-totals')).not.toBeInTheDocument();
    // A refusal isn't asked again.
    expect(overviewRequests()).toHaveLength(1);
  });

  it("says when the numbers didn't load, and Retry asks again", async () => {
    delete replies['/api/analytics/overview'];
    renderAnalytics();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Analytics didn't load. Can't reach Care Hub. Check your connection, then try again.",
    );
    expect(screen.getByTestId('analytics-error')).toBeInTheDocument();
    replies['/api/analytics/overview'] = () => json(200, overview);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('analytics-totals')).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-error')).not.toBeInTheDocument();
  });
});
