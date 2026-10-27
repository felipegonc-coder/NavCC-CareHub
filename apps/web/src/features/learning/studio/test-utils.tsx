import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { Course } from '@carehub/learning';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { StudioProvider } from './context';
import type { StudioClient } from './data/client';
import { createMemoryStudioClient } from './data/memory-client';
import type { MemoryStudioOptions } from './data/memory-client';
import { CourseEditorScreen, CoursePreviewScreen, StudioScreen } from './index';

// Test helpers for the Studio screens. Fictional data only.

/** A Studio client kept in memory, with ids "id-1", "id-2"… and a clock that moves a minute per change. */
export function testStudioClient(options: MemoryStudioOptions = {}): StudioClient {
  let count = 0;
  let time = Date.parse('2026-10-27T09:00:00.000Z');
  return createMemoryStudioClient({
    newId: () => `id-${(count += 1)}`,
    now: () => new Date((time += 60_000)),
    ...options,
  });
}

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

/** Renders the Studio routes at `path`, with a fresh query client that doesn't retry. */
export function renderStudio(
  path: string,
  options: { client?: StudioClient; canBuild?: boolean } = {},
) {
  const client = options.client ?? testStudioClient();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <StudioProvider client={client} canBuild={options.canBuild ?? true}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/learning/studio" element={<StudioScreen />} />
            <Route path="/learning/studio/courses/:courseId" element={<CourseEditorScreen />} />
            <Route
              path="/learning/studio/courses/:courseId/preview"
              element={<CoursePreviewScreen />}
            />
          </Routes>
          <Location />
        </MemoryRouter>
      </StudioProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** The text of each `<title>` on the page (React moves a screen's title into the head). */
export const pageTitles = (): string[] =>
  Array.from(document.querySelectorAll('title'), (title) => title.textContent ?? '');

/**
 * Saves `build(blank)` (from a blank standard course called "Hand hygiene") and opens it in the editor, once
 * its title shows.
 */
export async function renderEditor(
  build: (blank: Course) => Course = (blank) => blank,
  client: StudioClient = testStudioClient(),
) {
  const draft = await client.createCourse({ type: 'standard', title: 'Hand hygiene' });
  const course = build(draft.course);
  await client.saveCourse(course.id, course, draft.revision);
  const view = renderStudio(`/learning/studio/courses/${course.id}`, { client });
  await screen.findByRole('heading', { level: 1, name: course.title });
  return { ...view, courseId: course.id };
}
