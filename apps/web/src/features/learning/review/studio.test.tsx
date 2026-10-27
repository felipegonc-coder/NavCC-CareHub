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

/** A fake Learning API: `routes` answers "METHOD /api/learning/…"; anything else is a 404. */
function serve(routes: Record<string, (body: unknown) => Response>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url}`];
    return route
      ? route(body)
      : json(404, {
          error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
        });
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

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(href);
    const open = screen.getByRole('list', { name: 'Open links' });
    expect(await within(open).findByText(/Made by Tara Trainer/)).toBeTruthy();
    expect(within(open).getAllByRole('listitem')).toHaveLength(2);
    expect(within(open).queryByText(new RegExp(TOKEN))).toBeNull();
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

  it('says when there are no comments yet', async () => {
    serve({ [`GET ${API}/courses/${course.id}/comments`]: () => json(200, []) });
    renderWithQueries(<ReviewComments course={course} />);
    expect(
      await screen.findByText('No comments yet. Share the draft for review to get some.'),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download CSV' })).toBeNull();
  });
});
