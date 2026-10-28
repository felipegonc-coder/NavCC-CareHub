import { LearningPathSchema, type LearningPath, type PathSummary } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import { errorReply, jsonReply } from '../../player/test-utils';
import { StudioProvider } from '../context';
import type { StudioClient, StudioCourseSummary, StudioCourseState } from '../data/client';
import { testStudioClient } from '../test-utils';
import { PathEditorScreen, PathsStudioScreen } from './index';

// Test helpers for the Studio's path screens: a fake path API on `fetch`, Studio courses and the
// two routes. Fictional data only.

const API = '/api/learning/studio/paths';
const EDITED = '2026-10-27T09:00:00.000Z';

const course = (
  id: string,
  title: string,
  state: StudioCourseState,
  version: number | null,
  archived = false,
): StudioCourseSummary => ({
  id,
  title,
  type: 'standard',
  state,
  version,
  updatedAt: EDITED,
  archived,
  listed: true,
});

/** Studio courses: two live, one with unpublished changes, a draft and an archived one. */
export const STUDIO_COURSES: readonly StudioCourseSummary[] = [
  course('course-calls-with-care', 'Handling calls with care', 'live', 2),
  course('course-privacy-basics', 'Privacy basics', 'changed', 1),
  course('course-escalations-cert', 'Escalations certification', 'draft', null),
  course('course-fire-safety', 'Fire safety', 'live', 1),
  course('course-old-induction', 'Old induction', 'live', 3, true),
];

/** One call the screens made to the path API. */
export type PathCall = { method: string; url: string; body: unknown };

const summaryOf = (path: LearningPath): PathSummary => ({
  id: path.id,
  title: path.title,
  courseCount: path.courseIds.length,
  order: path.order,
  updatedAt: EDITED,
});

/**
 * A fake path API on `fetch`, holding `paths` (new ones get the ids "path-1", "path-2"…). Set
 * `server.status` to answer every call with that error, or `server.offline` to fail them all.
 */
export function servePaths(paths: readonly LearningPath[] = []) {
  const store = new Map(paths.map((path) => [path.id, structuredClone(path)] as const));
  const server: { status?: number; offline?: boolean } = {};
  const calls: PathCall[] = [];
  let created = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (server.offline) throw new TypeError('Failed to fetch');
    if (server.status) return errorReply(server.status);
    if (url === API && method === 'GET') return jsonReply(200, [...store.values()].map(summaryOf));
    if (url === API && method === 'POST') {
      created += 1;
      const start = { formatVersion: 1, id: `path-${created}`, courseIds: [], order: 'sequential' };
      const path = LearningPathSchema.parse(Object.assign(start, body));
      store.set(path.id, path);
      return jsonReply(201, path);
    }
    const id = url.startsWith(`${API}/`) ? decodeURIComponent(url.slice(API.length + 1)) : '';
    if (!store.has(id)) return errorReply(404);
    if (method === 'GET') return jsonReply(200, store.get(id));
    if (method === 'PUT') {
      store.set(id, LearningPathSchema.parse(body));
      return jsonReply(200, store.get(id));
    }
    if (method === 'DELETE') {
      store.delete(id);
      return new Response(null, { status: 204 });
    }
    return errorReply(404);
  });
  const sent = (method: string) => calls.filter((call) => call.method === method);
  return { store, server, calls, sent };
}

function Location() {
  const { pathname } = useLocation();
  return <p data-testid="location">{pathname}</p>;
}

/**
 * Renders the path routes at `path` with these Studio courses, and a query client that doesn't
 * wait before trying again.
 */
export function renderPaths(
  path: string,
  options: { courses?: readonly StudioCourseSummary[]; canBuild?: boolean } = {},
) {
  const courses = options.courses ?? STUDIO_COURSES;
  const client: StudioClient = {
    ...testStudioClient(),
    listCourses: async ({ archived = false } = {}) =>
      courses.filter((entry) => entry.archived === archived),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudioProvider client={client} canBuild={options.canBuild ?? true}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/learning/studio/paths" element={<PathsStudioScreen />} />
            <Route path="/learning/studio/paths/:pathId" element={<PathEditorScreen />} />
          </Routes>
          <Location />
        </MemoryRouter>
      </StudioProvider>
    </QueryClientProvider>,
  );
}
