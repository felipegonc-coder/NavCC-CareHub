import {
  lessonHref,
  sampleRequiredReadCourse,
  type Course,
  type LearnerCourseState,
} from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inOrder, learner, renderRoute, serveCourse } from '../player/test-utils';
import { CourseStartScreen } from './index';
import { formatSignedAt } from './SignOff';

const TITLE = 'Handling calls with care';
const locked = { status: 'locked' } as const;
const fresh: LearnerCourseState = {
  ...learner(inOrder, { 'calls-during': locked, 'calls-after': locked, 'calls-quiz': locked }),
  status: 'not_started',
};
const halfway: LearnerCourseState = {
  ...learner(inOrder, {
    'calls-before': { status: 'completed' },
    'calls-during': { status: 'in_progress' },
    'calls-after': locked,
    'calls-quiz': locked,
  }),
  percentComplete: 25,
  resume: { lessonId: 'calls-during', blockId: 'calls-during-check' },
};
const done = (state: Partial<LearnerCourseState>): LearnerCourseState => ({
  ...learner(inOrder, {
    'calls-before': { status: 'completed' },
    'calls-during': { status: 'completed' },
    'calls-after': { status: 'completed' },
    'calls-quiz': { status: 'completed' },
  }),
  percentComplete: 100,
  ...state,
});

/** Shows the start page of `course` from a fake API; lessons open a stand-in player. */
function show(course: Course, state: LearnerCourseState, options?: { course?: number }) {
  const server = serveCourse(course, state, options);
  renderRoute(`/learning/courses/${course.id}`, {
    '/learning/courses/:courseId': <CourseStartScreen />,
    '/learning/courses/:courseId/lessons/:lessonId': <p>The player</p>,
  });
  return server;
}

const button = (name: string) => screen.findByRole('link', { name });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CourseStartScreen', () => {
  it('says the course is not found for a link with a bad id, without asking the server', () => {
    const { calls } = serveCourse(inOrder, fresh);
    renderRoute('/learning/courses/no%20such%20course!', {
      '/learning/courses/:courseId': <CourseStartScreen />,
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Course not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows the course and a start button before the learner begins', async () => {
    show(inOrder, fresh);
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeInTheDocument();
    expect(document.title).toBe(`Care Hub · ${TITLE}`);
    expect(screen.getByText(inOrder.summary ?? '')).toBeInTheDocument();
    expect(screen.getByText('4 lessons · About 20 minutes')).toBeInTheDocument();
    const topics = screen.getByRole('list', { name: 'Topics' });
    expect(
      within(topics)
        .getAllByRole('listitem')
        .map((item: HTMLElement) => item.textContent),
    ).toEqual(['Phones', 'Onboarding']);
    expect(
      screen.getByText('Three short lessons and a final quiz. About 20 minutes.'),
    ).toBeVisible();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(await button('Start course')).toHaveAttribute(
      'href',
      lessonHref(inOrder.id, 'calls-before'),
    );
    expect(screen.getByRole('link', { name: '1. Before the call, Not started' })).toBeVisible();
    expect(screen.getByRole('link', { name: '2. During the call, Locked' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/learning');
  });

  it('carries on where the learner stopped', async () => {
    show(inOrder, halfway);
    expect(await button('Continue')).toHaveAttribute(
      'href',
      lessonHref(inOrder.id, 'calls-during', 'calls-during-check'),
    );
    expect(screen.getByText('In progress · 25% done')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(screen.getByText('1 of 4 lessons completed')).toBeInTheDocument();
  });

  it("uses the course's own words for the button", async () => {
    const renamed: Course = {
      ...inOrder,
      settings: { ...inOrder.settings, labels: { start: 'Begin the training' } },
    };
    show(renamed, fresh);
    expect(await button('Begin the training')).toBeInTheDocument();
  });

  it('shows the result of a finished course and offers a look back through it', async () => {
    show(inOrder, done({ status: 'passed', score: 87.5 }));
    expect(await button('Review the course')).toHaveAttribute(
      'href',
      lessonHref(inOrder.id, 'calls-before'),
    );
    expect(screen.getByText('Passed · score 88%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  it('says how much more time the course needs once everything else is done', async () => {
    const timed: Course = {
      ...inOrder,
      settings: { ...inOrder.settings, minimumCourseSeconds: 600 },
    };
    show(
      timed,
      done({ status: 'in_progress', blockedBy: 'minimum_course_time', activeSeconds: 420 }),
    );
    expect(
      await screen.findByText(
        'Almost done: spend 3 more minutes in the lessons to finish the course.',
      ),
    ).toBeInTheDocument();
  });

  it('opens a lesson from a link in the description', async () => {
    const linked: Course = {
      ...inOrder,
      description: [
        {
          runs: [
            { text: 'Start with ' },
            { text: 'the quiz', link: { kind: 'lesson', lessonId: 'calls-quiz' } },
          ],
        },
      ],
    };
    show(linked, fresh);
    fireEvent.click(await screen.findByRole('link', { name: 'the quiz' }));
    expect(await screen.findByText('The player')).toBeInTheDocument();
  });

  it('says the course is not found when it is missing or not shared', async () => {
    show(inOrder, fresh, { course: 404 });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Course not found' }),
    ).toBeInTheDocument();
  });

  it('tells guests that courses are not for them yet', async () => {
    show(inOrder, fresh, { course: 403 });
    expect(
      await screen.findByText("Courses aren't available for guest accounts yet."),
    ).toBeInTheDocument();
  });

  it('says why the course did not load, and tries again', async () => {
    const { server } = show(inOrder, fresh, { course: 400 });
    expect(
      await screen.findByRole('heading', { level: 1, name: "This course didn't load" }),
    ).toBeInTheDocument();
    server.course = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeInTheDocument();
  });
});

describe('the sign-off', () => {
  const course = sampleRequiredReadCourse;
  const statement = 'I have read the privacy basics and will follow them.';
  const read = learner(course, {
    'privacy-rules': { status: 'completed' },
    'privacy-quiz': { status: 'completed' },
  });

  it('shows the statement and asks the learner to read every lesson first', async () => {
    show(course, learner(course, { 'privacy-quiz': locked }));
    const section = await screen.findByRole('region', { name: 'Sign-off' });
    expect(within(section).getByText(statement)).toBeInTheDocument();
    expect(within(section).getByText('Read every lesson first, then sign here.')).toBeVisible();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('signs once the box is ticked, and says when', async () => {
    const { sent } = show(course, read);
    const almostDone = 'Almost done: sign below to finish the course.';
    expect(await screen.findByText(almostDone)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review the course' })).toHaveAttribute(
      'href',
      lessonHref(course.id, 'privacy-rules'),
    );
    const sign = screen.getByRole('button', { name: 'Sign' });
    expect(sign).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: statement }));
    expect(sign).toBeEnabled();
    fireEvent.click(sign);
    expect(await screen.findByText(/^Signed on /)).toHaveFocus();
    await waitFor(() =>
      expect(sent()).toEqual([expect.objectContaining({ type: 'acknowledged', statement })]),
    );
    expect(screen.queryByText(almostDone)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('says when a signed course was signed', async () => {
    const at = '2026-10-20T14:30:00.000Z';
    show(course, { ...read, status: 'passed', acknowledgedAt: at });
    expect(await screen.findByText(`Signed on ${formatSignedAt(at)}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  });
});
