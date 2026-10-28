import type { TeamViewResponse } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorReply, jsonReply, renderRoute } from '../../player/test-utils';
import { formatDay, NOT_FOUND, personReportHref, teamReportHref } from '../people/data';
import { TeamReportScreen } from './index';

// The viewer's profile is on Tokyo time, so days differ from UTC (decision 0317).
const ZONE = 'Asia/Tokyo';
vi.mock('../../data/timeZone', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProfileTimeZone: () => 'Asia/Tokyo',
}));

const API = '/api/learning/reports/team';

// Fictional groups, people and courses, as GET /reports/team sends them.
type Group = TeamViewResponse['groups'][number];
const group = (groupId: string, groupName: string, more: Partial<Group> = {}): Group => ({
  groupId,
  groupName,
  learners: 0,
  total: 0,
  notStarted: 0,
  inProgress: 0,
  completed: 0,
  passed: 0,
  failed: 0,
  overdue: 0,
  completionPercent: 0,
  averageScore: null,
  averageActiveSeconds: null,
  ...more,
});

const REPORT: TeamViewResponse = {
  courses: [
    { id: 'course-calls-with-care', title: 'Handling calls with care' },
    { id: 'course-privacy-basics', title: 'Privacy basics' },
  ],
  groups: [
    group('g-night', 'Night shift', {
      learners: 2,
      total: 3,
      inProgress: 1,
      completed: 1,
      passed: 1,
      overdue: 1,
      completionPercent: 67,
      averageScore: 88,
      averageActiveSeconds: 1_500,
    }),
    group('g-weekend', 'Weekend team'),
  ],
  people: [
    {
      id: 'u-ada',
      name: 'Ada Example',
      groupIds: ['g-night'],
      courses: 2,
      finished: 2,
      overdue: 0,
      lastActivityAt: '2026-10-03T16:00:00.000Z',
    },
    {
      id: 'u-bo',
      name: 'Bo Sample',
      groupIds: ['g-night', 'g-gone'],
      courses: 1,
      finished: 0,
      overdue: 1,
      lastActivityAt: null,
    },
  ],
};

/** Shows the team view at `path`, with the server's answers in `replies`, one per call. */
function showTeam(path: string, ...replies: (() => Response)[]) {
  const fetch = vi.spyOn(globalThis, 'fetch');
  fetch.mockImplementation(async (input) => {
    if (!String(input).startsWith(API)) return errorReply(404);
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return reply ? reply() : errorReply(404);
  });
  renderRoute(path, { '/learning/reports/team': <TeamReportScreen /> });
  return fetch;
}

const calledUrls = (fetch: ReturnType<typeof showTeam>) =>
  fetch.mock.calls.map(([input]) => String(input));

// jsdom has no layout, and the course list scrolls the chosen course into view.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('Team learning', () => {
  it("shows each group's numbers and each person, linking to their record", async () => {
    const fetch = showTeam(teamReportHref(), () => jsonReply(200, REPORT));
    expect(await screen.findByRole('heading', { level: 1, name: 'Team learning' })).toBeVisible();
    expect(document.title).toBe('Care Hub · Team learning');
    expect(screen.getByText('2 people · 2 groups · All courses')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      `${API}?format=csv`,
    );
    expect(calledUrls(fetch)).toEqual([API]);

    const [groups, people] = screen.getAllByRole('table').map((table) => within(table));
    const [, night, weekend] = groups?.getAllByRole('row').map((line) => within(line)) ?? [];
    expect(night?.getByRole('rowheader', { name: 'Night shift' })).toBeVisible();
    expect(night?.getByText('67%')).toBeVisible();
    expect(night?.getByText('2 of 3')).toBeVisible();
    expect(night?.getByText('1', { selector: '.text-danger' })).toBeVisible();
    expect(night?.getByText('88%')).toBeVisible();
    expect(night?.getByText('25 min')).toBeVisible();
    expect(weekend?.getAllByText('None')).toHaveLength(2);

    const [, ada, bo] = people?.getAllByRole('row').map((line) => within(line)) ?? [];
    expect(ada?.getByRole('link', { name: 'Ada Example' })).toHaveAttribute(
      'href',
      personReportHref('u-ada'),
    );
    expect(ada?.getByText('Night shift')).toBeVisible();
    // 16:00 UTC on 3 October is already 4 October in Tokyo.
    const lastActivity = formatDay('2026-10-03T16:00:00.000Z', ZONE);
    expect(lastActivity).not.toBe(formatDay('2026-10-03T16:00:00.000Z', 'UTC'));
    expect(ada?.getByText(lastActivity ?? '')).toBeVisible();
    // A group the viewer can't see is left out.
    expect(bo?.getByText('Night shift')).toBeVisible();
    expect(bo?.queryByText(/g-gone/)).toBeNull();
    expect(bo?.getByText('1', { selector: '.text-danger' })).toBeVisible();
    expect(bo?.getAllByText('None')).toHaveLength(1);
  });

  it('narrows to the course in the link, and the course filter changes it', async () => {
    const fetch = showTeam(teamReportHref('course-privacy-basics'), () => jsonReply(200, REPORT));
    expect(await screen.findByText('2 people · 2 groups · Privacy basics')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      `${API}?courseId=course-privacy-basics&format=csv`,
    );
    const filter = screen.getByRole('combobox', { name: 'Course' });
    expect(filter).toHaveTextContent('Privacy basics');

    fireEvent.keyDown(filter, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Handling calls with care' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(calledUrls(fetch)).toEqual([
        `${API}?courseId=course-privacy-basics`,
        `${API}?courseId=course-calls-with-care`,
      ]),
    );
    expect(await screen.findByText('2 people · 2 groups · Handling calls with care')).toBeVisible();

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Course' }), { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'All courses' }), {
      key: 'Enter',
    });
    expect(await screen.findByText('2 people · 2 groups · All courses')).toBeVisible();
    expect(calledUrls(fetch).at(-1)).toBe(API);
  });

  it('says when there are no groups to show', async () => {
    showTeam(teamReportHref(), () => jsonReply(200, { courses: [], groups: [], people: [] }));
    expect(await screen.findByText(/^No groups to show yet\./)).toBeVisible();
    expect(screen.getByText('0 people · 0 groups · All courses')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says a bad course link leads nowhere, without asking the server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    renderRoute('/learning/reports/team?courseId=not%20a%20course', {
      '/learning/reports/team': <TeamReportScreen />,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Team learning' })).toBeVisible();
    expect(screen.getByText(NOT_FOUND)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('explains a refusal, with no Try again', async () => {
    showTeam(teamReportHref(), () => errorReply(403));
    expect(
      await screen.findByText("You don't have access to this report. Ask an admin if you need it."),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
