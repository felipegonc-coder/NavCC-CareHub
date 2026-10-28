import { sampleStandardCourse, type ReviewComment, type ReviewLink } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewComments, ReviewSharing } from './studio';

// Built from a short pattern, so it doesn't look like a real secret: 43 base64url characters.
const TOKEN = 'Ab0-_'.repeat(8) + 'Ab0';
const course = sampleStandardCourse;
const API = '/api/learning/studio';

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { method: string; url: string; body: unknown };

const notFound = () =>
  json(404, { error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' } });

/** The signed-in author (GET /api/auth/me), a fictional person whose profile is on `timeZone`. */
const signedIn = (timeZone: string) =>
  json(200, {
    user: {
      id: 'person-1',
      email: 'tara.trainer@example.com',
      name: 'Tara Trainer',
      avatarUrl: null,
      isSiteAdmin: false,
      timeZone,
      use24h: false,
      weekStart: 0,
      mustChangePassword: false,
    },
    member: null,
    workspace: null,
  });

/** A day as the panels show it: in the profile time zone, America/Denver when it isn't known (decision 0317). */
const dayIn = (timeZone: string, iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(new Date(iso));

/**
 * A fake Learning API: `routes` answers "METHOD /api/learning/…", and anything else there is a 404. Calls outside
 * it aren't listed: the profile is on `timeZone` when it's given, and anything else gets a 404.
 */
function serve(routes: Record<string, (body: unknown) => Response>, timeZone?: string) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    if (!url.startsWith('/api/learning/')) {
      return url === '/api/auth/me' && timeZone ? signedIn(timeZone) : notFound();
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url}`];
    return route ? route(body) : notFound();
  });
  return calls;
}

function renderWithQueries(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const link = (overrides: Partial<ReviewLink> = {}): ReviewLink => ({
  id: 'link-1',
  createdAt: '2026-10-20T10:00:00.000Z',
  expiresAt: '2026-11-19T10:00:00.000Z',
  createdBy: { id: 'person-2', name: 'Ana Silva' },
  ...overrides,
});

const comment = (overrides: Partial<ReviewComment>): ReviewComment => ({
  id: 'comment-1',
  lessonId: 'calls-before',
  body: 'Say who the call is for.',
  author: { id: 'person-3', name: 'Ben Okafor' },
  createdAt: '2026-10-27T10:00:00.000Z',
  resolved: false,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReviewSharing', () => {
  it('makes a link, shows its address once to copy, and lists it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const calls = serve({
      [`GET ${API}/courses/${course.id}/review-links`]: () => json(200, [link()]),
      [`POST ${API}/courses/${course.id}/review-links`]: () =>
        json(201, {
          ...link({ id: 'link-2', createdBy: { id: 'person-1', name: 'Tara Trainer' } }),
          url: `/learning/review#${TOKEN}`,
        }),
    });
    renderWithQueries(<ReviewSharing courseId={course.id} />);
    expect(await screen.findByText(/Made by Ana Silva/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '30 days', pressed: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a link' }));
    const address = await screen.findByLabelText('Review link');
    const href = `${window.location.origin}/learning/review#${TOKEN}`;
    expect((address as HTMLInputElement).value).toBe(href);
    await waitFor(() => expect(document.activeElement).toBe(address));
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: `${API}/courses/${course.id}/review-links`,
      body: { days: 7 },
    });

    // The profile gets a 404 here, so days are in Care Hub's default time zone.
    expect(
      screen.getByText(
        `Copy it now: it's shown only this once. It works until ${dayIn('America/Denver', link().expiresAt)}.`,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(href);
    const open = screen.getByRole('list', { name: 'Open links' });
    expect(await within(open).findByText(/Made by Tara Trainer/)).toBeTruthy();
    expect(within(open).getAllByRole('listitem')).toHaveLength(2);
    expect(within(open).queryByText(new RegExp(TOKEN))).toBeNull();
  });

  it('shows days in the profile time zone, not the browser one', async () => {
    // Already 21 October in Tokyo, still the 20th in UTC and in Denver (and 19 November for the last day).
    const shared = link({
      createdAt: '2026-10-20T20:00:00.000Z',
      expiresAt: '2026-11-19T20:00:00.000Z',
    });
    serve(
      { [`GET ${API}/courses/${course.id}/review-links`]: () => json(200, [shared]) },
      'Asia/Tokyo',
    );
    renderWithQueries(<ReviewSharing courseId={course.id} />);
    const made = dayIn('Asia/Tokyo', shared.createdAt);
    expect(made).not.toBe(dayIn('UTC', shared.createdAt));
    expect(made).not.toBe(dayIn('America/Denver', shared.createdAt));
    expect(
      await screen.findByText(
        `Made by Ana Silva on ${made} · works until ${dayIn('Asia/Tokyo', shared.expiresAt)}`,
      ),
    ).toBeTruthy();
  });

  it('stops sharing a link', async () => {
    const calls = serve({
      [`GET ${API}/courses/${course.id}/review-links`]: () => json(200, [link()]),
      [`DELETE ${API}/review-links/link-1`]: () => new Response(null, { status: 204 }),
    });
    renderWithQueries(<ReviewSharing courseId={course.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByText('No links are open.')).toBeTruthy();
    expect(
      await screen.findByText('Sharing stopped. That link no longer opens the draft.'),
    ).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'Share for review' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(calls.at(-1)).toEqual({
      method: 'DELETE',
      url: `${API}/review-links/link-1`,
      body: undefined,
    });
  });

  it('says why a link was not made', async () => {
    const refusal = 'This course is shared by 20 review links already. Stop sharing one first.';
    serve({
      [`GET ${API}/courses/${course.id}/review-links`]: () => json(200, []),
      [`POST ${API}/courses/${course.id}/review-links`]: () =>
        json(409, { error: { code: 'conflict', message: refusal } }),
    });
    renderWithQueries(<ReviewSharing courseId={course.id} />);
    expect(await screen.findByText('No links are open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a link' }));
    expect((await screen.findByRole('alert')).textContent).toBe(refusal);
    expect(screen.queryByLabelText('Review link')).toBeNull();
  });
});

describe('ReviewComments', () => {
  const comments = [
    comment({
      id: 'comment-steps',
      lessonId: 'calls-during',
      blockId: 'calls-during-steps',
      body: 'Add a step for writing down the caller’s number.',
      createdAt: '2026-10-26T10:00:00.000Z',
    }),
    comment({ id: 'comment-lesson' }),
    comment({
      id: 'comment-tip',
      blockId: 'calls-before-tip',
      body: 'The tip repeats the text above it.',
      resolved: true,
    }),
  ];

  it('lists open comments in course order, and resolves one', async () => {
    const calls = serve({
      [`GET ${API}/courses/${course.id}/comments`]: () => json(200, comments),
      [`PATCH ${API}/comments/comment-lesson`]: () =>
        json(200, comment({ id: 'comment-lesson', resolved: true })),
    });
    renderWithQueries(<ReviewComments course={course} />);
    const list = await screen.findByRole('list', { name: 'Review comments' });
    expect(screen.getByText('2 open · 1 resolved')).toBeTruthy();
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual([
      '1. Before the call · Whole lesson',
      '2. During the call · Block 2',
    ]);
    expect(screen.getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toBe(
      `${API}/courses/${course.id}/comments.csv`,
    );

    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Resolve' }));
    expect(await within(items[0]!).findByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(within(items[0]!).getByText(/· Resolved/)).toBeTruthy();
    expect(screen.getByText('1 open · 2 resolved')).toBeTruthy();
    expect(calls.at(-1)).toEqual({
      method: 'PATCH',
      url: `${API}/comments/comment-lesson`,
      body: { resolved: true },
    });
  });

  it('shows resolved comments too when asked', async () => {
    serve({ [`GET ${API}/courses/${course.id}/comments`]: () => json(200, comments) });
    renderWithQueries(<ReviewComments course={course} />);
    await screen.findByRole('list', { name: 'Review comments' });
    expect(screen.queryByText('The tip repeats the text above it.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const items = within(screen.getByRole('list', { name: 'Review comments' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual([
      '1. Before the call · Whole lesson',
      '1. Before the call · Block 3',
      '2. During the call · Block 2',
    ]);
    expect(within(items[1]!).getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('dates comments in the profile time zone, not the browser one', async () => {
    // Already 28 October in Tokyo, still the 27th in UTC and in Denver.
    const createdAt = '2026-10-27T20:00:00.000Z';
    serve(
      { [`GET ${API}/courses/${course.id}/comments`]: () => json(200, [comment({ createdAt })]) },
      'Asia/Tokyo',
    );
    renderWithQueries(<ReviewComments course={course} />);
    const tokyo = dayIn('Asia/Tokyo', createdAt);
    expect(tokyo).not.toBe(dayIn('UTC', createdAt));
    expect(tokyo).not.toBe(dayIn('America/Denver', createdAt));
    expect(await screen.findByText(`Ben Okafor · ${tokyo}`)).toBeTruthy();
  });

  it('says when there are no comments yet', async () => {
    serve({ [`GET ${API}/courses/${course.id}/comments`]: () => json(200, []) });
    renderWithQueries(<ReviewComments course={course} />);
    expect(
      await screen.findByText('No comments yet. Share the draft for review to get some.'),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download CSV' })).toBeNull();
  });
});
