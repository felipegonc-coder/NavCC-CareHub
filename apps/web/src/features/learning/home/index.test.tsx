import type { MyLearningEntry, MyLearningResponse } from '@carehub/learning';
import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../catalog/data';
import { errorReply, jsonReply, LEARNER, renderRoute, signedInReply } from '../player/test-utils';
import { formatDay, formatDueDate } from './entry';
import { MyLearningScreen } from './index';

const entry = (courseId: string, title: string, change: Partial<MyLearningEntry> = {}) =>
  ({
    courseId,
    title,
    status: 'not_started',
    progressPercent: 0,
    assigned: true,
    required: false,
    dueDate: null,
    dueStatus: 'none',
    lastActivityAt: null,
    completedAt: null,
    href: `/learning/courses/${courseId}`,
    ...change,
  }) satisfies MyLearningEntry;

// 15:30 UTC on 12 October is already 13 October in Tokyo (the learner's zone), but not in Denver.
const FINISHED_AT = '2026-10-12T15:30:00.000Z';
const mine: MyLearningResponse = {
  continue: [
    entry('course-calls-with-care', 'Handling calls with care', {
      status: 'in_progress',
      progressPercent: 40,
      assigned: false,
      lastActivityAt: '2026-10-26T10:00:00.000Z',
    }),
  ],
  assigned: [
    entry('course-escalations', 'Escalations certification', {
      required: true,
      dueDate: '2026-11-20',
      dueStatus: 'upcoming',
    }),
  ],
  overdue: [
    entry('course-privacy', 'Privacy basics', {
      required: true,
      dueDate: '2026-10-20',
      dueStatus: 'overdue',
    }),
  ],
  finished: [
    entry('course-upset-member', 'Practice: an upset member', {
      status: 'passed',
      progressPercent: 100,
      completedAt: FINISHED_AT,
    }),
  ],
};
const nothing: MyLearningResponse = { continue: [], assigned: [], overdue: [], finished: [] };

const listed = (id: string, title: string): CatalogEntry => ({
  id,
  title,
  type: 'standard',
  lessonCount: 3,
  version: 1,
});
const catalog = [
  listed('course-calls-with-care', 'Handling calls with care'),
  listed('course-hold', 'Two-minute tip: putting a call on hold'),
];

type HomeOptions = { me?: number; list?: number; timeZone?: string | null };

/**
 * A fake Learning API with My learning (GET /me) and the catalog (try 400 or 403 for either), and
 * core's GET /api/auth/me with the time zone on the learner's profile (null for none).
 */
function serveHome(me: MyLearningResponse, list: CatalogEntry[], options: HomeOptions = {}) {
  const server = { me: 200, list: 200, timeZone: LEARNER.timeZone, ...options };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/auth/me') return signedInReply({ timeZone: server.timeZone });
    if (url === '/api/learning/me') {
      return server.me === 200 ? jsonReply(200, me) : errorReply(server.me);
    }
    if (url === '/api/learning/catalog') {
      return server.list === 200 ? jsonReply(200, list) : errorReply(server.list);
    }
    return errorReply(404);
  });
  return server;
}

/** A stand-in for a course's start page that says how it was opened. */
function StandInStart() {
  const { pathname, state } = useLocation();
  return <p>{`The start page at ${pathname} with ${JSON.stringify(state ?? null)}`}</p>;
}

const show = () =>
  renderRoute('/learning', {
    '/learning': <MyLearningScreen />,
    '/learning/courses/:courseId': <StandInStart />,
  });

const section = (name: string) => {
  const heading = screen.getByRole('heading', { level: 2, name });
  const region = heading.closest('section');
  if (!region) throw new Error(`No section for ${name}`);
  return within(region);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MyLearningScreen', () => {
  it("shows the learner's courses in their sections, then the catalog", async () => {
    serveHome(mine, catalog);
    show();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'My learning' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · My learning');
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading: HTMLElement) => heading.textContent),
    ).toEqual(['Overdue', 'Continue', 'Assigned to you', 'Finished', 'From the catalog']);
  });

  it('says where the learner is in each course and when it is due', async () => {
    serveHome(mine, catalog);
    show();
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    const going = section('Continue');
    expect(going.getByRole('link', { name: 'Handling calls with care' })).toHaveAttribute(
      'href',
      '/learning/courses/course-calls-with-care',
    );
    expect(going.getByText('40% done')).toBeInTheDocument();
    expect(
      going.getByRole('progressbar', { name: 'Handling calls with care progress' }),
    ).toHaveAttribute('aria-valuenow', '40');
    const late = section('Overdue');
    expect(late.getByText(`Overdue: it was due ${formatDueDate('2026-10-20')}`)).toBeVisible();
    expect(late.getByText('Required')).toBeInTheDocument();
    expect(late.getByText('Not started')).toBeInTheDocument();
    expect(
      section('Assigned to you').getByText(`Due ${formatDueDate('2026-11-20')}`),
    ).toBeVisible();
    const passed = `Passed on ${formatDay(FINISHED_AT, LEARNER.timeZone)}`;
    expect(section('Finished').getByText(passed)).toBeVisible();
  });

  it("shows the day a course was finished in the profile's time zone", async () => {
    // In the learner's zone it's another day than in UTC (the test browser's zone in CI) or Denver.
    for (const other of ['UTC', DEFAULT_TIME_ZONE]) {
      expect(formatDay(FINISHED_AT, LEARNER.timeZone)).not.toBe(formatDay(FINISHED_AT, other));
    }
    serveHome(mine, catalog);
    show();
    const passed = `Passed on ${formatDay(FINISHED_AT, LEARNER.timeZone)}`;
    expect(await screen.findByText(passed)).toBeVisible();
    // A profile with no zone, or one the browser doesn't know, is on Denver time.
    for (const timeZone of [null, 'Mars/Olympus_Mons']) {
      cleanup();
      vi.restoreAllMocks();
      serveHome(mine, catalog, { timeZone });
      show();
      const denver = `Passed on ${formatDay(FINISHED_AT, DEFAULT_TIME_ZONE)}`;
      expect(await screen.findByText(denver)).toBeVisible();
    }
  });

  it('shows due dates on the day they are stored, in any time zone', () => {
    const day = { day: 'numeric', month: 'short', year: 'numeric' } as const;
    // Midnight on 1 November where the browser is, shown where the browser is: always 1 November.
    const stored = new Intl.DateTimeFormat(undefined, day).format(new Date(2026, 10, 1));
    expect(formatDueDate('2026-11-01')).toBe(stored);
  });

  it('opens a course in progress where the learner stopped, and others at the start', async () => {
    serveHome(mine, catalog);
    show();
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    fireEvent.click(section('Continue').getByRole('link', { name: 'Handling calls with care' }));
    expect(
      await screen.findByText(
        'The start page at /learning/courses/course-calls-with-care with {"resume":true}',
      ),
    ).toBeInTheDocument();
    cleanup();
    show();
    await screen.findByRole('heading', { level: 1, name: 'My learning' });
    fireEvent.click(section('Overdue').getByRole('link', { name: 'Privacy basics' }));
    expect(
      await screen.findByText('The start page at /learning/courses/course-privacy with null'),
    ).toBeInTheDocument();
  });

  it('shows catalog courses that are not in My learning yet', async () => {
    serveHome(mine, catalog);
    show();
    expect(
      await screen.findByRole('link', { name: 'Two-minute tip: putting a call on hold' }),
    ).toHaveAttribute('href', '/learning/courses/course-hold');
    const more = section('From the catalog');
    expect(more.queryByRole('link', { name: 'Handling calls with care' })).not.toBeInTheDocument();
    expect(more.getByText('3 lessons')).toBeInTheDocument();
    expect(more.getByRole('link', { name: 'See the whole catalog' })).toHaveAttribute(
      'href',
      '/learning/catalog',
    );
  });

  it('says when there is nothing yet', async () => {
    serveHome(nothing, []);
    show();
    expect(
      await screen.findByText(
        'Nothing here yet. Courses assigned to you, and courses you start, show up here.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('No courses in the catalog yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('says when every catalog course is already in My learning', async () => {
    serveHome(mine, catalog.slice(0, 1));
    show();
    expect(
      await screen.findByText('Every course in the catalog is in My learning.'),
    ).toBeInTheDocument();
  });

  it('says when the catalog did not load, and tries again', async () => {
    const server = serveHome(mine, catalog, { me: 200, list: 400 });
    show();
    expect(await screen.findByText("The catalog didn't load.")).toBeInTheDocument();
    server.list = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('link', { name: 'Two-minute tip: putting a call on hold' }),
    ).toBeInTheDocument();
  });

  it('tells guests that courses are not for them yet', async () => {
    serveHome(mine, catalog, { me: 403, list: 403 });
    show();
    expect(
      await screen.findByText("Courses aren't available for guest accounts yet."),
    ).toBeInTheDocument();
  });

  it('says why My learning did not load, and tries again', async () => {
    const server = serveHome(mine, catalog, { me: 400, list: 200 });
    show();
    expect(
      await screen.findByRole('heading', { level: 1, name: "This page didn't load" }),
    ).toBeInTheDocument();
    server.me = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'My learning' }),
    ).toBeInTheDocument();
  });
});
