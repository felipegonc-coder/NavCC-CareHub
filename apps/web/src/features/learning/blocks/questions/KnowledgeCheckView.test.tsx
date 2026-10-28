import {
  richText,
  type KnowledgeCheckBlock,
  type LearnerCourseState,
  type PlayerCourse,
  type Question,
} from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockView, blockViews } from '../registry';
import { courseWith, learnerState, renderBlock } from '../test-utils';

const RIGHT = 'Hi, this is Sam from Brightside Support.';
const WRONG = 'Support, go ahead.';

const greeting: Question = {
  id: 'kc-greeting',
  type: 'single_choice',
  prompt: richText('Which greeting follows the guide?'),
  points: 1,
  options: [
    { id: 'greet-full', text: RIGHT, correct: true },
    {
      id: 'greet-short',
      text: WRONG,
      correct: false,
      feedback: richText("Say your name and the team's name."),
    },
  ],
};

function knowledgeCheck(allowRetry: boolean, question = greeting): KnowledgeCheckBlock {
  return { id: 'kc', type: 'knowledge_check', allowRetry, question };
}

/** The event for answering the check; nothing about the answer itself (decision 0310). */
const answered = (correct: boolean) => ({
  type: 'knowledge_check_answered',
  lessonId: 'lesson-test',
  blockId: 'kc',
  correct,
});

function answer(text: string) {
  fireEvent.click(screen.getByRole('radio', { name: text }));
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
}

function renderWith(
  block: KnowledgeCheckBlock,
  change: (course: PlayerCourse, state: LearnerCourseState) => [PlayerCourse, LearnerCourseState],
) {
  const { course, lesson } = courseWith([block]);
  const [shown, state] = change(course, learnerState(course));
  render(
    <BlockView
      block={block}
      lesson={lesson}
      course={shown}
      mode="learn"
      state={state}
      emit={vi.fn()}
      go={vi.fn()}
    />,
  );
}

describe('KnowledgeCheckView', () => {
  it('is the view for knowledge check blocks', () => {
    expect(blockViews.knowledge_check).toBeDefined();
    renderBlock(knowledgeCheck(true));
    expect(screen.getByText('Knowledge check')).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'Which greeting follows the guide?' }),
    ).toBeInTheDocument();
  });

  it('checks only once the question is answered', () => {
    renderBlock(knowledgeCheck(true));
    const check = screen.getByRole('button', { name: 'Check answer' });
    expect(check).toBeDisabled();
    expect(check).toHaveAccessibleDescription('Answer the question to check it.');
    fireEvent.click(screen.getByRole('radio', { name: WRONG }));
    expect(check).toBeEnabled();
  });

  it('records only whether the answer was right', () => {
    const { emit } = renderBlock(knowledgeCheck(true));
    answer(RIGHT);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(answered(true));
    expect(screen.getByRole('status')).toHaveTextContent('Correct');
    expect(screen.getByRole('radio', { name: RIGHT })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument();
  });

  it('shows the feedback for a wrong answer', () => {
    const { emit } = renderBlock(knowledgeCheck(true));
    answer(WRONG);
    expect(emit).toHaveBeenCalledWith(answered(false));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Not quite');
    expect(status).toHaveTextContent("Say your name and the team's name.");
  });

  it('lets the learner try again when retries are on', () => {
    const { emit } = renderBlock(knowledgeCheck(true));
    answer(WRONG);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('radio', { name: WRONG })).toBeEnabled();
    expect(screen.getByRole('radio', { name: WRONG })).not.toBeChecked();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    answer(RIGHT);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(answered(true));
  });

  it('offers no retry when retries are off', () => {
    renderBlock(knowledgeCheck(false));
    answer(WRONG);
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it("uses the course's own word for trying again", () => {
    renderWith(knowledgeCheck(true), (course, state) => [
      { ...course, settings: { ...course.settings, labels: { retry: 'Have another go' } } },
      state,
    ]);
    answer(WRONG);
    expect(screen.getByRole('button', { name: 'Have another go' })).toBeInTheDocument();
  });

  it('says so when a check without retries was answered before', () => {
    const at = '2025-10-01T09:00:00.000Z';
    renderWith(knowledgeCheck(false), (course, state) => [
      course,
      {
        ...state,
        knowledgeChecks: [
          {
            lessonId: 'lesson-test',
            blockId: 'kc',
            answers: 1,
            firstCorrect: false,
            lastCorrect: false,
            firstAnsweredAt: at,
            lastAnsweredAt: at,
          },
        ],
      },
    ]);
    expect(screen.getByText('Which greeting follows the guide?')).toBeInTheDocument();
    expect(screen.getByText("You've answered this check.")).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument();
  });

  it('checks an ordering question in the order shown', () => {
    const { emit } = renderBlock(
      knowledgeCheck(true, {
        id: 'kc-order',
        type: 'ordering',
        prompt: richText('Put the call in order'),
        points: 1,
        items: ['Greet', 'Listen', 'Close'].map((text) => ({ id: `i-${text}`, text })),
      }),
    );
    const shown = screen
      .getAllByRole('listitem')
      .map((item: HTMLElement) => item.textContent?.replace(/^\d+/, ''));
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(emit).toHaveBeenCalledWith(answered(shown.join() === 'Greet,Listen,Close'));
  });
});
