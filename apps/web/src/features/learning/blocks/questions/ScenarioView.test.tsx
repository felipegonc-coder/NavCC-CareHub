import {
  richText,
  type ContentLesson,
  type LearnerCourseState,
  type ScenarioBlock,
} from '@carehub/learning';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockView, blockViews } from '../registry';
import { courseWith, learnerState, renderBlock } from '../test-utils';

// Fictional data only.
const SORRY = "I'm sorry about the wait. Let me check where it is.";
const POLICY = 'Deliveries can take up to five days.';
const HAND_ON = "I'll pass you to the escalations team.";
const REDELIVER = 'Book a delivery for tomorrow morning.';
const WAIT = 'Ask Maya to wait a few more days.';

const lateParcel: ScenarioBlock = {
  id: 'scenario',
  type: 'scenario',
  title: 'A late parcel',
  intro: richText('Maya calls about a parcel that should have come on Monday.'),
  characters: [{ id: 'maya', name: 'Maya Lind', role: 'Customer' }],
  startSceneId: 'start',
  passScore: 8,
  scenes: [
    {
      id: 'start',
      speakerId: 'maya',
      text: 'My parcel is three days late and nobody has called me.',
      choices: [
        {
          id: 'sorry',
          text: SORRY,
          points: 5,
          coaching: richText('Saying sorry first calms things down.'),
          next: { kind: 'scene', sceneId: 'depot' },
        },
        {
          id: 'policy',
          text: POLICY,
          points: -2,
          coaching: richText('That sounds like an excuse.'),
          next: { kind: 'retry' },
        },
        {
          id: 'hand-on',
          text: HAND_ON,
          points: 0,
          next: { kind: 'lesson', lessonId: 'passing-on' },
        },
      ],
    },
    {
      id: 'depot',
      text: 'You find the parcel at the local depot.',
      choices: [
        { id: 'redeliver', text: REDELIVER, points: 5, next: { kind: 'scene', sceneId: 'happy' } },
        { id: 'wait', text: WAIT, points: 0, next: { kind: 'scene', sceneId: 'meh' } },
      ],
    },
    {
      id: 'happy',
      text: 'Maya thanks you.',
      choices: [],
      ending: {
        outcome: 'great',
        title: 'Maya is happy',
        text: richText('The parcel comes the next day.'),
      },
    },
    {
      id: 'meh',
      text: 'Maya sighs.',
      choices: [],
      ending: { outcome: 'okay', title: "Maya accepts, but she isn't pleased" },
    },
  ],
};

const choose = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** The view in a course with a second lesson, for the "lesson" choice. */
function renderScenario(change: (state: LearnerCourseState) => LearnerCourseState = (s) => s) {
  const { course, lesson } = courseWith([lateParcel]);
  const other: ContentLesson = {
    id: 'passing-on',
    kind: 'content',
    title: 'Passing a call on',
    blocks: [],
  };
  const full = { ...course, lessons: [...course.lessons, other] };
  const emit = vi.fn();
  const go = vi.fn();
  render(
    <BlockView
      block={lateParcel}
      lesson={lesson}
      course={full}
      mode="learn"
      state={change(learnerState(full))}
      emit={emit}
      go={go}
    />,
  );
  return { emit, go };
}

const finished = (choiceIds: string[]) => ({
  type: 'scenario_finished',
  lessonId: 'lesson-test',
  blockId: 'scenario',
  choiceIds,
});

describe('ScenarioView', () => {
  it('is the view for scenario blocks: title, introduction and characters', () => {
    expect(blockViews.scenario).toBeDefined();
    renderBlock(lateParcel);
    expect(screen.getByRole('heading', { name: 'A late parcel' })).toBeInTheDocument();
    expect(screen.getByText(/should have come on Monday/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Characters' })).toHaveTextContent('Maya LindCustomer');
    expect(screen.queryByText(SORRY)).not.toBeInTheDocument();
  });

  it('plays to an ending, with coaching on the way, and records every choice', async () => {
    const { emit } = renderScenario();
    choose('Start scenario');
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/three days late/));
    expect(screen.getByText('Maya Lind')).toBeInTheDocument();
    choose(SORRY);
    expect(screen.getByText('Saying sorry first calms things down.')).toBeInTheDocument();
    choose('Continue');
    expect(screen.getByText('You find the parcel at the local depot.')).toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
    choose(REDELIVER);
    expect(screen.getByText('A great outcome')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Maya is happy' })).toBeInTheDocument();
    expect(screen.getByText('Your score: 10 of 10 points.')).toBeInTheDocument();
    expect(screen.getByText('You passed. The pass score is 8 points.')).toBeInTheDocument();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(finished(['sorry', 'redeliver']));
  });

  it("says when the learner didn't reach the pass score", () => {
    const { emit } = renderScenario();
    choose('Start scenario');
    choose(SORRY);
    choose('Continue');
    choose(WAIT);
    expect(screen.getByText('An okay outcome')).toBeInTheDocument();
    expect(
      screen.getByText("You didn't pass this time. The pass score is 8 points."),
    ).toBeInTheDocument();
    expect(emit).toHaveBeenCalledWith(finished(['sorry', 'wait']));
  });

  it('a "try again" choice shows its coaching, then the same choices', () => {
    const { emit } = renderScenario();
    choose('Start scenario');
    choose(POLICY);
    expect(screen.getByText('That sounds like an excuse.')).toBeInTheDocument();
    choose('Try again');
    expect(screen.getByRole('button', { name: SORRY })).toBeInTheDocument();
    expect(emit).not.toHaveBeenCalled();
    choose(SORRY);
    choose('Continue');
    choose(REDELIVER);
    expect(emit).toHaveBeenCalledWith(finished(['policy', 'sorry', 'redeliver']));
    expect(screen.getByText('Your score: 8 of 10 points.')).toBeInTheDocument();
  });

  it('a choice that leads to another lesson ends the run and offers that lesson', () => {
    const { emit, go } = renderScenario();
    choose('Start scenario');
    choose(HAND_ON);
    expect(emit).toHaveBeenCalledWith(finished(['hand-on']));
    choose('Go to Passing a call on');
    expect(go).toHaveBeenCalledWith({ kind: 'lesson', lessonId: 'passing-on' });
  });

  it('plays again from the start', () => {
    renderScenario();
    choose('Start scenario');
    choose(HAND_ON);
    choose('Try again');
    expect(screen.getByText(/three days late/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SORRY })).toBeInTheDocument();
  });

  it("shows the learner's earlier runs", () => {
    renderScenario((state) => ({
      ...state,
      scenarios: [
        {
          lessonId: 'lesson-test',
          blockId: 'scenario',
          runs: 2,
          bestScore: 10,
          choiceIds: ['sorry', 'wait'],
          score: 5,
          maxScore: 10,
          passed: false,
          outcome: 'okay',
          lessonJump: null,
          lastFinishedAt: '2026-10-20T09:00:00Z',
        },
      ],
    }));
    expect(
      screen.getByText("You've finished this scenario. Your best score is 10 of 10."),
    ).toBeInTheDocument();
    choose('Try again');
    expect(screen.getByRole('button', { name: SORRY })).toBeInTheDocument();
  });

  it("can't start without scenes", () => {
    renderBlock({ ...lateParcel, scenes: [] });
    expect(screen.getByText('This scenario has no scenes yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start scenario' })).not.toBeInTheDocument();
  });
});
