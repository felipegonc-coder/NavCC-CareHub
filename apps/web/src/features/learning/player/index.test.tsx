import { courseHref, learnerCourse, type LearnerCourseState } from '@carehub/learning';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { courseKey, progressKey, type LiveCourse } from './data';
import { PlayerScreen } from './index';
import { inOrder, learner, lessonPath, renderRoute, serveCourse } from './test-utils';

const API = `/api/learning/courses/${inOrder.id}`;
const READY = 'Ready means record open, notes read, headset on.';
const locked = { status: 'locked' } as const;
const start = learner(inOrder, {
  'calls-before': { status: 'in_progress', activeSeconds: 60 },
  'calls-during': locked,
  'calls-after': locked,
  'calls-quiz': locked,
});

const serve = (options?: { course?: number; offline?: boolean; full?: boolean }) =>
  serveCourse(inOrder, start, options);

const renderScreen = (path: string) =>
  renderRoute(path, { '/learning/courses/:courseId/lessons/:lessonId': <PlayerScreen /> });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlayerScreen', () => {
  it('says the lesson is not found for a link with a bad id, without asking the server', () => {
    const { calls } = serve();
    renderScreen('/learning/courses/no%20such%20course!/lessons/calls-before');
    expect(screen.getByRole('heading', { level: 1, name: 'Lesson not found' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Lesson not found');
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toHaveAttribute(
      'href',
      '/learning',
    );
    expect(calls).toHaveLength(0);
  });

  it('loads the live course and the progress, then opens the lesson', async () => {
    const { calls, sent } = serve();
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Before the call' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Before the call');
    expect(calls.filter((call) => call.method === 'GET').map((call) => call.url)).toEqual([
      API,
      `${API}/progress`,
    ]);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({ type: 'lesson_opened', lessonId: 'calls-before' });
    expect(sent()[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), at: expect.any(String) }),
    );
  });

  it('keeps the learner view of the course, whose quiz lessons have no questions', async () => {
    for (const full of [false, true]) {
      // `full`: a server that sends the whole course; the player turns it into the learner view.
      serve({ full });
      const client = renderScreen(lessonPath(inOrder, 'calls-before'));
      await screen.findByRole('heading', { level: 1, name: 'Before the call' });
      const course = client.getQueryData<LiveCourse>(courseKey(inOrder.id))?.course;
      expect(course).toEqual(learnerCourse(inOrder));
      expect(course?.lessons.find((lesson) => lesson.kind === 'quiz')).not.toHaveProperty(
        'questions',
      );
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it('sends each step and keeps the state the server replies with', async () => {
    const { sent } = serve();
    const client = renderScreen(lessonPath(inOrder, 'calls-before'));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(READY)).toBeInTheDocument();
    await waitFor(() =>
      expect(sent()).toContainEqual(
        expect.objectContaining({
          type: 'block_completed',
          lessonId: 'calls-before',
          blockId: 'calls-before-continue',
        }),
      ),
    );
    await waitFor(() =>
      expect(
        client
          .getQueryData<LearnerCourseState>(progressKey(inOrder.id))
          ?.lessons.find((lesson) => lesson.lessonId === 'calls-before')?.completedBlockIds,
      ).toEqual(['calls-before-continue']),
    );
  });

  it('lets the learner keep going while their steps wait to be sent', async () => {
    serve({ offline: true });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(READY)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the course is not found when it is missing or not shared', async () => {
    serve({ course: 404 });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Course not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toBeInTheDocument();
  });

  it('tells guests that courses are not for them yet', async () => {
    serve({ course: 403 });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No access to courses' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Courses aren't available for guest accounts yet."),
    ).toBeInTheDocument();
  });

  it('says why the lesson did not load, and tries again', async () => {
    const { server } = serve({ course: 400 });
    renderScreen(lessonPath(inOrder, 'calls-before'));
    expect(
      await screen.findByRole('heading', { level: 1, name: "This lesson didn't load" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Check the link, then try again.')).toBeInTheDocument();
    server.course = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Before the call' }),
    ).toBeInTheDocument();
  });

  it('says the lesson is not found when the course has no such lesson', async () => {
    serve();
    renderScreen(lessonPath(inOrder, 'calls-gone'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lesson not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the course' })).toHaveAttribute(
      'href',
      courseHref(inOrder.id),
    );
  });
});
