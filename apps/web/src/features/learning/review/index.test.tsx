import { sampleStandardCourse, type ReviewComment } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewScreen } from './index';

// Built from a short pattern, so it doesn't look like a real secret: 43 base64url characters.
const TOKEN = 'Ab0-_'.repeat(8) + 'Ab0';
const NOT_FOUND = 'This was deleted, or the link is wrong.';
const course = sampleStandardCourse;
const [first] = course.lessons;
const firstBlock = first?.kind === 'content' ? first.blocks[0] : undefined;

const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 'comment-1',
  lessonId: first?.id ?? '',
  body: 'Say who the call is for.',
  author: { id: 'person-1', name: 'Ana Silva' },
  // Late on 26 October in Care Hub's default time zone (America/Denver), already the 27th in UTC.
  createdAt: '2026-10-27T03:00:00.000Z',
  resolved: false,
  ...overrides,
});

const EXPIRES_AT = '2026-11-26T03:00:00.000Z';
/** A day as the screen shows it: in the profile time zone, America/Denver when it isn't set (decision 0317). */
const dayIn = (timeZone: string, iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(new Date(iso));

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { method: string; url: string; token: string | null; body: unknown };

/** The signed-in reviewer (GET /api/auth/me), a fictional person whose profile is on `timeZone`. */
const signedIn = (timeZone: string) =>
  json(200, {
    user: {
      id: 'person-2',
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

/**
 * A fake Learning API with one shared draft; `status` answers the review call instead. Calls outside it aren't
 * listed: the profile is on `timeZone` when it's given, and anything else gets a 404.
 */
function serveReview(
  options: { status?: number; comments?: ReviewComment[]; post?: Response; timeZone?: string } = {},
) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).startsWith('/api/learning/')) {
      if (String(input) === '/api/auth/me' && options.timeZone) return signedIn(options.timeZone);
      return json(404, { error: { code: 'not_found', message: NOT_FOUND } });
    }
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = {
      method: init?.method ?? 'GET',
      url: String(input),
      token: headers.get('X-Review-Token'),
      body,
    };
    calls.push(call);
    if (call.token !== TOKEN)
      return json(404, { error: { code: 'not_found', message: NOT_FOUND } });
    if (call.method === 'GET' && call.url === '/api/learning/review') {
      if (options.status) {
        return json(options.status, { error: { code: 'not_found', message: NOT_FOUND } });
      }
      return json(200, {
        course,
        comments: options.comments ?? [],
        expiresAt: EXPIRES_AT,
      });
    }
    if (call.method === 'POST' && call.url === '/api/learning/review/comments') {
      return options.post ?? json(201, comment({ id: 'comment-new', ...body }));
    }
    return json(404, { error: { code: 'not_found', message: NOT_FOUND } });
  });
  return calls;
}

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ReviewScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Review screen', () => {
  it('says the link is wrong when the fragment has no token', () => {
    const calls = serveReview();
    renderAt('/learning/review');
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    cleanup();
    renderAt('/learning/review#not-a-token');
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('opens the draft in full, sending the token only in its header', async () => {
    const calls = serveReview({ comments: [comment()] });
    renderAt(`/learning/review#${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: course.title })).toBeTruthy();
    expect(calls[0]).toEqual({
      method: 'GET',
      url: '/api/learning/review',
      token: TOKEN,
      body: undefined,
    });
    expect(calls.some((call) => call.url.includes(TOKEN))).toBe(false);
    course.lessons.forEach((lesson, index) => {
      expect(
        screen.getByRole('heading', { level: 2, name: `${index + 1}. ${lesson.title}` }),
      ).toBeTruthy();
    });
    const lessonComments = screen.getByRole('list', { name: 'Comments on this lesson' });
    expect(within(lessonComments).getByText('Say who the call is for.')).toBeTruthy();
    // The profile gets a 404 here, so days are in Care Hub's default time zone.
    expect(
      within(lessonComments).getByText(
        `Ana Silva · ${dayIn('America/Denver', comment().createdAt)}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Read the draft and leave comments for its authors. This link works until ${dayIn('America/Denver', EXPIRES_AT)}.`,
      ),
    ).toBeTruthy();
  });

  it('shows days in the profile time zone, not the browser one', async () => {
    // Already 28 October in Tokyo, still the 27th in UTC and in Denver.
    const createdAt = '2026-10-27T20:00:00.000Z';
    serveReview({ comments: [comment({ createdAt })], timeZone: 'Asia/Tokyo' });
    renderAt(`/learning/review#${TOKEN}`);
    const tokyo = dayIn('Asia/Tokyo', createdAt);
    expect(tokyo).not.toBe(dayIn('UTC', createdAt));
    expect(tokyo).not.toBe(dayIn('America/Denver', createdAt));
    const lessonComments = await screen.findByRole('list', { name: 'Comments on this lesson' });
    expect(await within(lessonComments).findByText(`Ana Silva · ${tokyo}`)).toBeTruthy();
    expect(
      screen.getByText(
        `Read the draft and leave comments for its authors. This link works until ${dayIn('Asia/Tokyo', EXPIRES_AT)}.`,
      ),
    ).toBeTruthy();
  });

  it('leaves a comment on a block', async () => {
    const calls = serveReview();
    renderAt(`/learning/review#${TOKEN}`);
    const [button] = await screen.findAllByRole('button', { name: 'Comment on this block' });
    fireEvent.click(button!);
    fireEvent.change(screen.getByLabelText('Your comment on this block'), {
      target: { value: '  Add a photo of the desk.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const thread = await screen.findByRole('list', { name: 'Comments on this block' });
    expect(within(thread).getByText('Add a photo of the desk.')).toBeTruthy();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: '/api/learning/review/comments',
      token: TOKEN,
      body: { lessonId: first?.id, blockId: firstBlock?.id, body: 'Add a photo of the desk.' },
    });
  });

  it('checks a comment before sending it, and says why the server refused one', async () => {
    const refusal = 'This part was taken out of the draft. Reload to see the latest version.';
    const calls = serveReview({
      post: json(409, { error: { code: 'conflict', message: refusal } }),
    });
    renderAt(`/learning/review#${TOKEN}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Comment on question 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Write a comment first.')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);

    fireEvent.change(screen.getByLabelText('Your comment on question 1'), {
      target: { value: 'Two answers look right.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(refusal)).toBeTruthy();
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1));
  });

  it('says the link is wrong when it was stopped or has expired', async () => {
    serveReview({ status: 404 });
    renderAt(`/learning/review#${TOKEN}`);
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
