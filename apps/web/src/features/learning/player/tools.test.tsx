import { PLAYER_TEXT_SIZE_KEY } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { inOrder, learner, renderPlayer } from './test-utils';

const locked = { status: 'locked' } as const;
const start = learner(inOrder, {
  'calls-during': locked,
  'calls-after': locked,
  'calls-quiz': locked,
});

const toolButton = (name: string) => screen.getByRole('button', { name });
const search = (words: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search this course' }), {
    target: { value: words },
  });
const summary = () => within(screen.getByRole('search')).getByRole('status');
const results = () => within(screen.getByRole('list', { name: 'Results' })).getAllByRole('link');
const lessonArea = () => document.querySelector('[data-text-size]');

afterEach(() => {
  window.localStorage.clear();
});

describe('search inside the course', () => {
  it('finds every place with the words, in locked lessons too, and opens one', () => {
    renderPlayer(inOrder, start, 'calls-before');
    fireEvent.click(toolButton('Search this course'));
    expect(toolButton('Search this course')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search this course' })).toHaveFocus();
    search('NOTES');
    expect(summary()).toHaveTextContent('3 places match.');
    expect(results().map((link: HTMLElement) => link.textContent)).toEqual([
      "Lesson 1: Before the callOpen the member's record, check recent notes and take a breath.",
      'Lesson 1: Before the callReady means record open, notes read, headset on.',
      "Lesson 3: After the call · LockedIf it isn't in the notes, the next person can't help.",
    ]);
    expect(results()[0]?.querySelector('mark')).toHaveTextContent('notes');
    fireEvent.click(results()[2] as HTMLElement);
    expect(screen.getByRole('heading', { level: 1, name: 'After the call' })).toBeInTheDocument();
    expect(screen.getByText('Finish "Before the call" first.')).toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(toolButton('Search this course')).toHaveAttribute('aria-expanded', 'false');
  });

  it('asks for more letters, says when nothing matches, and closes with Escape', () => {
    renderPlayer(inOrder, start, 'calls-before');
    fireEvent.click(toolButton('Search this course'));
    expect(summary()).toBeEmptyDOMElement();
    search('a');
    expect(summary()).toHaveTextContent('Type at least 2 letters.');
    search('zebra');
    expect(summary()).toHaveTextContent('Nothing in this course matches "zebra".');
    expect(screen.queryByRole('list', { name: 'Results' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(toolButton('Search this course')).toHaveFocus();
    fireEvent.click(toolButton('Search this course'));
    expect(screen.getByRole('searchbox', { name: 'Search this course' })).toHaveValue('zebra');
  });

  it('says when a result is further on, behind a continue block', () => {
    renderPlayer(inOrder, start, 'calls-before');
    fireEvent.click(toolButton('Search this course'));
    search('headset');
    expect(results()).toHaveLength(2);
    fireEvent.click(results()[1] as HTMLElement);
    expect(
      screen.getByText(
        "What you're looking for comes further on in this lesson. Carry on to reach it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Before the call' })).toHaveFocus();
  });
});

describe('text size', () => {
  it('makes lesson text bigger and smaller, one step at a time, and remembers it', () => {
    const { unmount } = renderPlayer(inOrder, start, 'calls-before');
    fireEvent.click(toolButton('Text size'));
    const control = screen.getByRole('group', { name: 'Text size' });
    const size = within(control).getByRole('status');
    expect(size).toHaveTextContent('Standard');
    expect(within(control).getByRole('button', { name: 'Smaller' })).toBeDisabled();
    expect(lessonArea()).toHaveAttribute('data-text-size', 'standard');
    for (let step = 0; step < 3; step += 1)
      fireEvent.click(within(control).getByRole('button', { name: 'Bigger' }));
    expect(size).toHaveTextContent('Largest');
    expect(within(control).getByRole('button', { name: 'Bigger' })).toBeDisabled();
    expect(lessonArea()).toHaveAttribute('data-text-size', 'largest');
    fireEvent.click(within(control).getByRole('button', { name: 'Smaller' }));
    expect(size).toHaveTextContent('Larger');
    expect(window.localStorage.getItem(PLAYER_TEXT_SIZE_KEY)).toBe('larger');
    unmount();
    renderPlayer(inOrder, start, 'calls-before');
    expect(lessonArea()).toHaveAttribute('data-text-size', 'larger');
  });
});
