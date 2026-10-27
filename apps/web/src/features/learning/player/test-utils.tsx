// Test-only helpers for the player (the app never imports this file).
import {
  sampleStandardCourse,
  type Course,
  type Id,
  type LearnerCourseState,
  type LessonProgress,
  type NewProgressEvent,
  type ProgressEvent,
} from '@carehub/learning';
import { render } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { vi } from 'vitest';
import { withPending } from './pending';
import { Player } from './Player';

/** The fictional sample course, taken in order: Before, During and After the call, Final quiz. */
export const inOrder: Course = {
  ...sampleStandardCourse,
  settings: { ...sampleStandardCourse.settings, lessonOrder: 'sequential' },
};

/** A learner's state: every lesson not started, apart from the changes in `lessons`. */
export function learner(
  course: Course,
  lessons: Record<Id, Partial<LessonProgress>> = {},
): LearnerCourseState {
  return {
    courseId: course.id,
    status: 'in_progress',
    blockedBy: null,
    startedAt: null,
    completedAt: null,
    lastActivityAt: null,
    activeSeconds: 0,
    percentComplete: 0,
    lessons: course.lessons.map((lesson) => ({
      lessonId: lesson.id,
      status: 'not_started',
      activeSeconds: 0,
      completedBlockIds: [],
      minimumMet: true,
      lastOpenedAt: null,
      completedAt: null,
      ...lessons[lesson.id],
    })),
    quizzes: [],
    knowledgeChecks: [],
    scenarios: [],
    acknowledgedAt: null,
    score: null,
    resume: null,
    rejected: [],
  };
}

let counter = 0;
const stamp = (event: NewProgressEvent): ProgressEvent =>
  ({ ...event, id: `event-${(counter += 1)}`, at: '2026-10-27T09:00:00.000Z' }) as ProgressEvent;

export const lessonPath = (course: Course, lessonId: Id) =>
  `/learning/courses/${course.id}/lessons/${lessonId}`;

/**
 * Shows the player in a memory router at `lessonId`. Emitted events are recorded in `emit` and
 * applied to the state as the server would, so continue blocks open and lessons complete.
 */
export function renderPlayer(course: Course, state: LearnerCourseState, lessonId: Id) {
  const emit = vi.fn();
  function Harness() {
    const params = useParams();
    const [current, setCurrent] = useState(state);
    return (
      <Player
        course={course}
        state={current}
        lessonId={params.lessonId ?? ''}
        mode="learn"
        emit={(event) => {
          emit(event);
          setCurrent((before) => withPending(course, before, [stamp(event)]));
        }}
      />
    );
  }
  const view = render(
    <MemoryRouter initialEntries={[lessonPath(course, lessonId)]}>
      <Routes>
        <Route path="/learning/courses/:courseId/lessons/:lessonId" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, emit };
}
