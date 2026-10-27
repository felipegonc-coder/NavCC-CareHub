import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { inOrder, learner, lessonPath, renderPlayer } from './test-utils';

const locked = { status: 'locked' } as const;
const start = learner(inOrder, {
  'calls-before': { status: 'in_progress', activeSeconds: 60 },
  'calls-during': locked,
  'calls-after': locked,
  'calls-quiz': locked,
});
const atEnd = learner(inOrder, {
  'calls-before': {
    status: 'in_progress',
    activeSeconds: 60,
    completedBlockIds: ['calls-before-continue'],
  },
  'calls-during': locked,
  'calls-after': locked,
  'calls-quiz': locked,
});
const READY = 'Ready means record open, notes read, headset on.';

describe('Player', () => {
  it('shows the open lesson, its title and the outline of every lesson', () => {
    renderPlayer(inOrder, start, 'calls-before');
    expect(screen.getByRole('heading', { level: 1, name: 'Before the call' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Before the call');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const outline = screen.getByRole('navigation', { name: 'Course outline' });
    expect(within(outline).getByText('0 of 4 lessons completed')).toBeInTheDocument();
    const current = within(outline).getByRole('link', { name: '1. Before the call, In progress' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(
      within(outline).getByRole('link', { name: '2. During the call, Locked' }),
    ).toHaveAttribute('title', 'Finish "Before the call" first.');
  });

  it('hides what follows a continue block until it is passed, then moves to it', () => {
    const { emit } = renderPlayer(inOrder, start, 'calls-before');
    expect(emit).toHaveBeenCalledWith({ type: 'lesson_opened', lessonId: 'calls-before' });
    expect(screen.queryByText(READY)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Lessons' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(emit).toHaveBeenCalledWith({
      type: 'block_completed',
      lessonId: 'calls-before',
      blockId: 'calls-before-continue',
    });
    expect(screen.getByText(READY)).toBeInTheDocument();
    expect(document.getElementById('block-calls-before-ready')).toHaveFocus();
    expect(screen.getByRole('navigation', { name: 'Lessons' })).toBeInTheDocument();
  });

  it('completes the lesson with Next and opens the next one, now unlocked', () => {
    const { emit } = renderPlayer(inOrder, atEnd, 'calls-before');
    fireEvent.click(screen.getByRole('button', { name: 'Next lesson' }));
    expect(emit).toHaveBeenCalledWith({ type: 'lesson_completed', lessonId: 'calls-before' });
    expect(screen.getByRole('heading', { level: 1, name: 'During the call' })).toHaveFocus();
    expect(document.title).toBe('Care Hub · During the call');
    expect(emit).toHaveBeenCalledWith({ type: 'lesson_opened', lessonId: 'calls-during' });
    const outline = screen.getByRole('navigation', { name: 'Course outline' });
    expect(within(outline).getByText('1 of 4 lessons completed')).toBeInTheDocument();
    expect(
      within(outline).getByRole('link', { name: '1. Before the call, Completed' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous lesson' })).toHaveAttribute(
      'href',
      lessonPath(inOrder, 'calls-before'),
    );
  });

  it('keeps Next off until the minimum time is spent, and says so', () => {
    const early = learner(inOrder, {
      'calls-before': { status: 'in_progress', completedBlockIds: ['calls-before-continue'] },
      'calls-during': locked,
    });
    const { emit } = renderPlayer(inOrder, early, 'calls-before');
    const next = screen.getByRole('button', { name: 'Next lesson' });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute('aria-describedby');
    expect(
      screen.getByText('Stay with this lesson a little longer to finish it (1 minute left).'),
    ).toBeInTheDocument();
    fireEvent.click(next);
    expect(emit).not.toHaveBeenCalledWith({ type: 'lesson_completed', lessonId: 'calls-before' });
  });

  it('says what to finish first in a locked lesson, and records nothing', () => {
    const { emit } = renderPlayer(inOrder, start, 'calls-after');
    expect(screen.getByRole('heading', { level: 1, name: 'After the call' })).toBeInTheDocument();
    expect(screen.getByText('Finish "Before the call" first.')).toBeInTheDocument();
    expect(document.getElementById('block-calls-after-intro')).toBeNull();
    expect(screen.getByRole('link', { name: 'Previous lesson' })).toHaveAttribute(
      'href',
      lessonPath(inOrder, 'calls-during'),
    );
    expect(screen.queryByRole('button', { name: 'Next lesson' })).not.toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
  });

  it('shows a note for a quiz until the quiz view lands, and ends on the last lesson', () => {
    const free = { ...inOrder, settings: { ...inOrder.settings, lessonOrder: 'free' as const } };
    renderPlayer(free, learner(free), 'calls-quiz');
    expect(screen.getByText("This quiz can't be shown here yet.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next lesson' })).not.toBeInTheDocument();
  });

  it('hides and shows the outline', () => {
    renderPlayer(inOrder, start, 'calls-before');
    fireEvent.click(screen.getByRole('button', { name: 'Hide course outline' }));
    expect(screen.queryByRole('navigation', { name: 'Course outline' })).not.toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'Show course outline' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(show);
    expect(screen.getByRole('navigation', { name: 'Course outline' })).toBeInTheDocument();
  });

  it('follows the course outline setting: closed at first, or hidden', () => {
    const closed = { ...inOrder, settings: { ...inOrder.settings, sidebar: 'closed' as const } };
    const first = renderPlayer(closed, start, 'calls-before');
    expect(screen.getByRole('button', { name: 'Show course outline' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Course outline' })).not.toBeInTheDocument();
    first.unmount();
    const hidden = { ...inOrder, settings: { ...inOrder.settings, sidebar: 'hidden' as const } };
    renderPlayer(hidden, start, 'calls-before');
    expect(screen.queryByRole('button', { name: /course outline/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Course outline' })).not.toBeInTheDocument();
  });
});
