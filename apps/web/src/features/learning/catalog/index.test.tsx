import { courseHref } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorReply, jsonReply, renderRoute } from '../player/test-utils';
import type { CatalogEntry } from './data';
import { CatalogScreen } from './index';

const entries: CatalogEntry[] = [
  {
    id: 'course-calls-with-care',
    title: 'Handling calls with care',
    type: 'standard',
    summary: 'Greet, listen and close every call so the member knows what happens next.',
    topics: ['Phones', 'Onboarding'],
    estimatedMinutes: 20,
    lessonCount: 4,
    version: 3,
  },
  {
    id: 'course-upset-member',
    title: 'Practice: an upset member',
    type: 'scenario_lab',
    summary: 'Try different replies to a frustrated member and see where they lead.',
    topics: ['Phones'],
    lessonCount: 1,
    version: 1,
  },
  {
    id: 'course-escalations',
    title: 'Escalations certification',
    type: 'certification',
    estimatedMinutes: 45,
    lessonCount: 5,
    version: 2,
  },
];

/** The catalog from a fake API: `status` for its reply (try 403 or 400). */
function serveCatalog(list: CatalogEntry[], options: { status?: number } = {}) {
  const server = { status: 200, ...options };
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    calls.push(String(input));
    if (String(input) !== '/api/learning/catalog') return errorReply(404);
    return server.status === 200 ? jsonReply(200, list) : errorReply(server.status);
  });
  return { server, calls };
}

const show = (path = '/learning/catalog') =>
  renderRoute(path, { '/learning/catalog': <CatalogScreen /> });

const titles = () =>
  within(screen.getByRole('main'))
    .queryAllByRole('heading', { level: 3 })
    .map((heading: HTMLElement) => heading.textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CatalogScreen', () => {
  it('lists every course with its facts, each opening its start page', async () => {
    const { calls } = serveCatalog(entries);
    show();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Catalog');
    expect(calls).toEqual(['/api/learning/catalog']);
    expect(titles()).toEqual([
      'Handling calls with care',
      'Practice: an upset member',
      'Escalations certification',
    ]);
    expect(screen.getByRole('link', { name: 'Handling calls with care' })).toHaveAttribute(
      'href',
      courseHref('course-calls-with-care'),
    );
    expect(screen.getByText('4 lessons · About 20 minutes')).toBeInTheDocument();
    expect(screen.getByText('1 lesson')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 courses');
  });

  it('finds courses by any word in the title, summary or topics', async () => {
    serveCatalog(entries);
    show();
    const search = await screen.findByRole('searchbox', { name: 'Search courses' });
    fireEvent.change(search, { target: { value: 'MEMBER' } });
    expect(titles()).toEqual(['Handling calls with care', 'Practice: an upset member']);
    fireEvent.change(search, { target: { value: 'member frustrated' } });
    expect(titles()).toEqual(['Practice: an upset member']);
    expect(screen.getByRole('status')).toHaveTextContent('1 course');
  });

  it('keeps only the courses on a topic', async () => {
    serveCatalog(entries);
    show();
    const topics = await screen.findByRole('group', { name: 'Topics' });
    expect(
      within(topics)
        .getAllByRole('button')
        .map((button: HTMLElement) => button.textContent),
    ).toEqual(['All topics', 'Onboarding', 'Phones']);
    fireEvent.click(within(topics).getByRole('button', { name: 'Onboarding' }));
    expect(within(topics).getByRole('button', { name: 'Onboarding' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(titles()).toEqual(['Handling calls with care']);
    fireEvent.click(within(topics).getByRole('button', { name: 'All topics' }));
    expect(titles()).toHaveLength(3);
  });

  it('reads the search from the address, and clears it when nothing matches', async () => {
    serveCatalog(entries);
    show('/learning/catalog?q=refunds&topic=Phones');
    expect(await screen.findByRole('searchbox', { name: 'Search courses' })).toHaveValue('refunds');
    expect(screen.getByRole('status')).toHaveTextContent('No courses match your search.');
    expect(titles()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(screen.getByRole('searchbox', { name: 'Search courses' })).toHaveValue('');
    expect(titles()).toHaveLength(3);
  });

  it('says so when the catalog has no courses yet', async () => {
    serveCatalog([]);
    show();
    expect(
      await screen.findByText(
        "No courses in the catalog yet. They show up here once they're published.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('tells guests that courses are not for them yet', async () => {
    serveCatalog(entries, { status: 403 });
    show();
    expect(
      await screen.findByText("Courses aren't available for guest accounts yet."),
    ).toBeInTheDocument();
  });

  it('says why the catalog did not load, and tries again', async () => {
    const { server } = serveCatalog(entries, { status: 400 });
    show();
    expect(
      await screen.findByRole('heading', { level: 1, name: "This page didn't load" }),
    ).toBeInTheDocument();
    server.status = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog' })).toBeInTheDocument();
  });
});
