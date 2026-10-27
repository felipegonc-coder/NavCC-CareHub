import {
  courseHref,
  pathPage,
  sampleLearningPath,
  type CourseStatus,
  type LearningPath,
  type PathCourseInfo,
} from '@carehub/learning';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorReply, jsonReply, renderRoute } from '../player/test-utils';
import { minutesText, pathHref } from './data';
import { PathScreen } from './index';

// The sample new-starter path: three courses, taken in order.
const COURSES: PathCourseInfo[] = [
  {
    id: 'course-calls-with-care',
    title: 'Handling calls with care',
    summary: 'Greet, listen and close the call well.',
    estimatedMinutes: 20,
  },
  { id: 'course-privacy-basics', title: 'Privacy basics', estimatedMinutes: 15 },
  { id: 'course-escalations-cert', title: 'Escalations certification' },
];

/** Shows the path page, with the server's answer worked out by `pathPage` from these statuses. */
function showPath(statuses: Record<string, CourseStatus>, path: LearningPath = sampleLearningPath) {
  const answer = pathPage(path, COURSES, statuses);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === `/api/learning/paths/${path.id}` ? jsonReply(200, answer) : errorReply(404),
  );
  renderRoute(pathHref(path.id), { '/learning/paths/:pathId': <PathScreen /> });
}

const steps = () => screen.getAllByRole('listitem');

afterEach(() => vi.restoreAllMocks());

describe('Learning path page', () => {
  it('shows the courses in order, locks the ones after the next, and continues', async () => {
    showPath({ 'course-calls-with-care': 'passed', 'course-privacy-basics': 'in_progress' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'New starter path' }),
    ).toBeVisible();
    expect(document.title).toBe('Care Hub · New starter path');
    expect(screen.getByText('Your first two weeks at Brightside Support.')).toBeVisible();
    expect(screen.getByText('1 of 3 courses done')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'New starter path progress' })).toHaveAttribute(
      'aria-valuenow',
      '33',
    );
    expect(screen.getByRole('link', { name: 'Continue: Privacy basics' })).toHaveAttribute(
      'href',
      courseHref('course-privacy-basics'),
    );
    expect(screen.getByText(/Take them in order/)).toBeVisible();

    const [first, second, third] = steps().map((step) => within(step));
    expect(first?.getByRole('link', { name: 'Handling calls with care' })).toHaveAttribute(
      'href',
      courseHref('course-calls-with-care'),
    );
    expect(first?.getByText('Greet, listen and close the call well.')).toBeVisible();
    expect(first?.getByText(minutesText(20))).toBeVisible();
    expect(first?.getByText('Passed')).toHaveClass('text-success');
    expect(second?.getByText('In progress')).toBeVisible();
    expect(third?.getByRole('heading', { name: 'Escalations certification' })).toBeVisible();
    expect(third?.queryByRole('link')).toBeNull();
    expect(third?.getByText('Opens once the courses before it are done')).toBeVisible();
  });

  it('starts with the first course, and leaves nothing locked on a free path', async () => {
    showPath({}, { ...sampleLearningPath, order: 'free' });
    expect(await screen.findByText('0 of 3 courses done')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Start: Handling calls with care' })).toBeVisible();
    expect(screen.getByText('Take them in any order.')).toBeVisible();
    expect(steps().map((step) => within(step).getByRole('link').textContent)).toEqual(
      COURSES.map((course) => course.title),
    );
    expect(screen.getAllByText('Not started')).toHaveLength(3);
  });

  it('says when every course is done, with no button', async () => {
    showPath({
      'course-calls-with-care': 'completed',
      'course-privacy-basics': 'passed',
      'course-escalations-cert': 'passed',
    });
    expect(await screen.findByText("You've finished every course in this path.")).toBeVisible();
    expect(screen.queryByRole('link', { name: /^(Start|Continue):/ })).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('marks a failed course, which stays next until it is passed', async () => {
    showPath({ 'course-calls-with-care': 'failed' });
    expect(await screen.findByText('Not passed')).toHaveClass('text-danger');
    expect(screen.getByRole('link', { name: 'Continue: Handling calls with care' })).toBeVisible();
    expect(screen.getAllByText('Opens once the courses before it are done')).toHaveLength(2);
  });

  it('says so when the learner can open none of its courses', async () => {
    showPath({}, { ...sampleLearningPath, courseIds: ['course-not-published'] });
    expect(await screen.findByText('This path has no courses you can open yet.')).toBeVisible();
    expect(screen.getByText('No courses to take yet.')).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says when the path is not there', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => errorReply(404));
    renderRoute(pathHref('path-gone'), { '/learning/paths/:pathId': <PathScreen /> });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Learning path not found' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toHaveAttribute(
      'href',
      '/learning',
    );
  });

  it('tells guests learning paths are not for them', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => errorReply(403));
    renderRoute(pathHref('path-new-starter'), { '/learning/paths/:pathId': <PathScreen /> });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No access to learning paths' }),
    ).toBeVisible();
  });
});
