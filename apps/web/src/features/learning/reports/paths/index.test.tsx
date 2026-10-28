import type { PathReportResponse } from '@carehub/learning';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorReply, jsonReply, renderRoute } from '../../player/test-utils';
import { formatDay, NOT_FOUND, pathReportHref, personReportHref } from '../people/data';
import { PathReportScreen } from './index';

// The viewer's profile is on Tokyo time, so days differ from UTC (decision 0317).
const ZONE = 'Asia/Tokyo';
vi.mock('../../data/timeZone', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProfileTimeZone: () => 'Asia/Tokyo',
}));

const PATH = 'path-new-agent';
const API = `/api/learning/reports/paths/${PATH}`;

// A fictional path and the people on it, as GET /reports/paths/:id sends them.
type Row = PathReportResponse['rows'][number];
const row = (learnerId: string, learnerName: string, more: Partial<Row> = {}): Row => ({
  learnerId,
  learnerName,
  groupIds: ['g-night'],
  status: 'not_started',
  completed: 0,
  total: 3,
  percent: 0,
  nextCourseId: 'welcome',
  nextCourseTitle: 'Welcome to Care',
  lastActivityAt: null,
  completedAt: null,
  ...more,
});

const REPORT: PathReportResponse = {
  path: { id: PATH, title: 'New agent path' },
  courses: [
    { id: 'welcome', title: 'Welcome to Care' },
    { id: 'tools', title: 'Our tools' },
    { id: 'calls', title: 'Taking calls' },
  ],
  learners: 3,
  notStarted: 1,
  inProgress: 1,
  completed: 1,
  completionPercent: 33,
  rows: [
    row('u-ada', 'Ada Example', {
      status: 'completed',
      completed: 3,
      percent: 100,
      nextCourseId: null,
      nextCourseTitle: null,
      lastActivityAt: '2026-10-24T16:00:00.000Z',
      completedAt: '2026-10-24T16:00:00.000Z',
    }),
    row('u-bo', 'Bo Sample', {
      status: 'in_progress',
      completed: 1,
      percent: 33,
      nextCourseId: 'tools',
      nextCourseTitle: 'Our tools',
      lastActivityAt: '2026-10-26T08:00:00.000Z',
    }),
    row('u-cy', 'Cy Person'),
  ],
};

/** Shows the path report, with the server's answer. */
function showReport(reply: () => Response) {
  const fetch = vi.spyOn(globalThis, 'fetch');
  fetch.mockImplementation(async (input) => (String(input) === API ? reply() : errorReply(404)));
  renderRoute(pathReportHref(PATH), { '/learning/reports/paths/:pathId': <PathReportScreen /> });
  return fetch;
}

afterEach(() => vi.restoreAllMocks());

describe('Path report', () => {
  it('shows the numbers, the courses in order and how far each person is', async () => {
    showReport(() => jsonReply(200, REPORT));
    expect(await screen.findByRole('heading', { level: 1, name: 'New agent path' })).toBeVisible();
    expect(document.title).toBe('Care Hub · New agent path · Path report');
    expect(
      screen.getByText('3 people · 1 completed (33%) · 1 in progress · 1 not started'),
    ).toBeVisible();
    const courses = within(screen.getByRole('list'));
    expect(courses.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Welcome to Care',
      'Our tools',
      'Taking calls',
    ]);
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      `${API}?format=csv`,
    );

    const [, ada, bo, cy] = screen.getAllByRole('row').map((line) => within(line));
    expect(ada?.getByRole('link', { name: 'Ada Example' })).toHaveAttribute(
      'href',
      personReportHref('u-ada'),
    );
    expect(ada?.getByText('Completed')).toHaveClass('text-success');
    expect(ada?.getByText('100%')).toBeVisible();
    // 16:00 UTC on 24 October is already 25 October in Tokyo.
    const finished = formatDay('2026-10-24T16:00:00.000Z', ZONE);
    expect(finished).not.toBe(formatDay('2026-10-24T16:00:00.000Z', 'UTC'));
    expect(ada?.getAllByText(finished ?? '')).toHaveLength(2);

    expect(bo?.getByText('In progress')).toBeVisible();
    expect(bo?.getByText('Our tools')).toBeVisible();
    expect(bo?.getByText(formatDay('2026-10-26T08:00:00.000Z', ZONE) ?? '')).toBeVisible();
    expect(bo?.getAllByText('None')).toHaveLength(1);

    expect(cy?.getByText('Not started')).toBeVisible();
    expect(cy?.getByText('Welcome to Care')).toBeVisible();
    expect(cy?.getAllByText('None')).toHaveLength(2);
  });

  it('calls someone the report has no name for "Unknown person"', async () => {
    showReport(() => jsonReply(200, { ...REPORT, rows: [row('u-dee', '')] }));
    expect(await screen.findByRole('link', { name: 'Unknown person' })).toHaveAttribute(
      'href',
      personReportHref('u-dee'),
    );
  });

  it('says when nobody is on the path yet', async () => {
    showReport(() =>
      jsonReply(200, {
        ...REPORT,
        learners: 0,
        notStarted: 0,
        inProgress: 0,
        completed: 0,
        completionPercent: 0,
        rows: [],
      }),
    );
    expect(await screen.findByText('Nobody is on this path yet.')).toBeVisible();
    expect(
      screen.getByText('0 people · 0 completed (0%) · 0 in progress · 0 not started'),
    ).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says a bad link leads nowhere, without asking the server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    renderRoute('/learning/reports/paths/not%20a%20path', {
      '/learning/reports/paths/:pathId': <PathReportScreen />,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Path report' })).toBeVisible();
    expect(screen.getByText(NOT_FOUND)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says when the path is not there, with no Try again', async () => {
    showReport(() => errorReply(404));
    expect(await screen.findByText(NOT_FOUND)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
