import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { matchRoutes, MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { routes, screens } from './routes';

// The routes from docs/learning/PLAN.md, all under /learning.
const PLAN_PATHS = [
  'learning',
  'learning/catalog',
  'learning/courses/:courseId',
  'learning/courses/:courseId/lessons/:lessonId',
  'learning/paths/:pathId',
  'learning/certificates',
  'learning/certificates/:certificateId',
  'learning/studio',
  'learning/studio/courses/:courseId',
  'learning/studio/courses/:courseId/preview',
  'learning/studio/paths',
  'learning/studio/paths/:pathId',
  'learning/studio/banks',
  'learning/studio/banks/:bankId',
  'learning/assign',
  'learning/reports',
  'learning/reports/courses/:courseId',
  'learning/reports/overdue',
  'learning/reports/people/:personId',
  'learning/reports/team',
  'learning/reports/paths/:pathId',
  'learning/review/:token',
];

afterEach(cleanup);

describe('Learning routes', () => {
  it('has every route from the plan, once, each loading lazily', () => {
    expect(routes.map((route) => route.path)).toEqual(PLAN_PATHS);
    expect(routes.every((route) => typeof route.lazy === 'function' && !route.Component)).toBe(
      true,
    );
  });

  it('sends each address to its screen', () => {
    const matched = (url: string) => matchRoutes(routes, url)?.at(-1)?.route.path;
    expect(matched('/learning')).toBe('learning');
    expect(matched('/learning/courses/c1')).toBe('learning/courses/:courseId');
    expect(matched('/learning/courses/c1/lessons/l2')).toBe(
      'learning/courses/:courseId/lessons/:lessonId',
    );
    expect(matched('/learning/studio/courses/c1/preview')).toBe(
      'learning/studio/courses/:courseId/preview',
    );
    expect(matched('/learning/reports/overdue')).toBe('learning/reports/overdue');
    expect(matched('/learning/reports/courses/c1')).toBe('learning/reports/courses/:courseId');
    expect(matched('/learning/review/abc123')).toBe('learning/review/:token');
    expect(matched('/learning/unknown/page')).toBeUndefined();
  });

  it('loads a screen with one main landmark, a heading and a Care Hub title for every route', async () => {
    const problems: string[] = [];
    for (const { path, load } of screens) {
      const Screen = await load();
      // Real screens read their route and call the API, as inside the app.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Screen />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      if (screen.queryAllByRole('main').length !== 1) problems.push(`${path}: needs one main`);
      if (!screen.queryByRole('heading', { level: 1 })?.textContent) {
        problems.push(`${path}: needs a heading`);
      }
      if (!/^Care Hub · \S/.test(document.title)) problems.push(`${path}: needs a title`);
      cleanup();
    }
    expect(problems).toEqual([]);
  });
});
