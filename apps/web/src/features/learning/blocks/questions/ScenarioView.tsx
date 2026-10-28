import {
  chooseScenario,
  playerLabels,
  scenarioResult,
  startScenario,
  type Link,
  type PlayerCourse,
  type RichText,
  type ScenarioBlock,
  type ScenarioChoice,
  type ScenarioProgress,
  type ScenarioScene,
  type ScenarioState,
} from '@carehub/learning';
import { Avatar, Button } from '@carehub/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useMediaUrl } from '../../media';
import type { BlockViewProps } from '../registry';
import { RichTextView } from '../text';

type Character = ScenarioBlock['characters'][number];
type Ending = NonNullable<ScenarioScene['ending']>;

/** The choice just made; it shows until the learner carries on (or with the ending). */
type Picked = { choice: ScenarioChoice; coaching: RichText | null };

/** A run in progress: the learner's place and the choice to show before moving on. */
type Play = { run: ScenarioState; picked: Picked | null };

type Shared = { course: PlayerCourse; go(link: Link): void };

const OUTCOMES: Record<Ending['outcome'], string> = {
  great: 'A great outcome',
  okay: 'An okay outcome',
  poor: 'A poor outcome',
};

const choiceClasses =
  'rounded border border-border bg-bg px-3 py-2 text-left text-body text-fg hover:bg-fill-hover max-md:min-h-11';

/**
 * A branching scenario: the learner reads each scene and picks what to say or do; coaching shows
 * after a choice, and the run ends at an ending or a jump to another lesson. Practice only: when a
 * run ends it records every choice made (`scenario_finished`), and the learner can play again.
 */
export function ScenarioView(props: BlockViewProps<ScenarioBlock>) {
  const { block, lesson, course, state, emit, go } = props;
  const labels = playerLabels(course);
  const titleId = useId();
  const [play, setPlay] = useState<Play | null>(null);
  const [moves, setMoves] = useState(0);
  const screen = useRef<HTMLDivElement>(null);
  // Each step shows a new screen; the focus moves to it so it's read out.
  useEffect(() => {
    if (moves > 0) screen.current?.focus();
  }, [moves]);

  const finished = state.scenarios.find(
    (run) => run.lessonId === lesson.id && run.blockId === block.id,
  );
  const ready = block.scenes.some((scene) => scene.id === block.startSceneId);

  const show = (next: Play) => {
    setPlay(next);
    setMoves((count) => count + 1);
  };
  const finish = (run: ScenarioState) =>
    emit({
      type: 'scenario_finished',
      lessonId: lesson.id,
      blockId: block.id,
      choiceIds: run.choiceIds,
    });
  const start = () => {
    const run = startScenario(block);
    show({ run, picked: null });
    if (run.ended) finish(run);
  };
  const choose = (choiceId: string) => {
    if (!play) return;
    const step = chooseScenario(block, play.run, choiceId);
    if (!step.ok) return;
    const pause = step.ended || step.coaching !== null || step.choice.next.kind === 'retry';
    show({
      run: step.state,
      picked: pause ? { choice: step.choice, coaching: step.coaching } : null,
    });
    if (step.ended) finish(step.state);
  };

  const scene = play && block.scenes.find((s) => s.id === play.run.sceneId);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded border border-border p-4 md:p-6"
    >
      <h2 id={titleId} className="text-h3 text-fg">
        {block.title}
      </h2>
      {!play ? (
        <>
          <RichTextView value={block.intro} course={course} go={go} />
          {block.characters.length > 0 && (
            <ul aria-label="Characters" className="flex flex-wrap gap-4">
              {block.characters.map((character) => (
                <li key={character.id}>
                  <Person character={character} />
                </li>
              ))}
            </ul>
          )}
          {finished && <p className="text-small text-muted">{finishedLine(finished)}</p>}
          {ready ? (
            <Button onClick={start} className="self-start">
              {finished ? labels.retry : 'Start scenario'}
            </Button>
          ) : (
            <p className="text-small text-muted">This scenario has no scenes yet.</p>
          )}
        </>
      ) : (
        <div
          key={moves}
          ref={screen}
          tabIndex={-1}
          className="flex flex-col gap-4 focus:outline-none"
        >
          {play.run.ended ? (
            <>
              {play.picked && <PickedNote picked={play.picked} course={course} go={go} />}
              <Outcome block={block} run={play.run} course={course} go={go} />
              <Button variant="secondary" onClick={start} className="self-start">
                {labels.retry}
              </Button>
            </>
          ) : play.picked ? (
            <>
              <PickedNote picked={play.picked} course={course} go={go} />
              <Button onClick={() => show({ run: play.run, picked: null })} className="self-start">
                {play.picked.choice.next.kind === 'retry' ? labels.retry : labels.continue}
              </Button>
            </>
          ) : (
            scene && (
              <>
                <SceneText scene={scene} characters={block.characters} />
                <ul aria-label="What do you do?" className="flex flex-col gap-2">
                  {scene.choices.map((choice) => (
                    <li key={choice.id} className="flex flex-col">
                      <button
                        type="button"
                        className={choiceClasses}
                        onClick={() => choose(choice.id)}
                      >
                        {choice.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>
      )}
    </section>
  );
}

/** A character's picture, name and role. The picture is decorative: the name is written next to it. */
function Person({ character }: { character: Character }) {
  const src = useMediaUrl(character.avatar?.media);
  return (
    <span className="flex items-center gap-2">
      <Avatar name={character.name} src={src} decorative />
      <span className="flex flex-col">
        <span className="text-body font-medium text-fg">{character.name}</span>
        {character.role && <span className="text-small text-muted">{character.role}</span>}
      </span>
    </span>
  );
}

/** What happens in a scene, and who says it. */
function SceneText({ scene, characters }: { scene: ScenarioScene; characters: Character[] }) {
  const speaker = characters.find((character) => character.id === scene.speakerId);
  return (
    <div className="flex flex-col gap-3">
      {speaker && <Person character={speaker} />}
      <p className="whitespace-pre-line rounded bg-fill p-4 text-body text-fg">{scene.text}</p>
    </div>
  );
}

/** The choice the learner made, with its coaching note. */
function PickedNote({ picked, course, go }: Shared & { picked: Picked }) {
  return (
    <div className="flex flex-col gap-2 border-l-4 border-border pl-4">
      <p className="text-body text-fg">
        <span className="font-medium">You chose: </span>
        {picked.choice.text}
      </p>
      <RichTextView value={picked.coaching ?? undefined} course={course} go={go} />
    </div>
  );
}

/** How the run ended: the ending, the score against the pass score, or the lesson it leads to. */
function Outcome({
  block,
  run,
  course,
  go,
}: Shared & { block: ScenarioBlock; run: ScenarioState }) {
  const result = scenarioResult(block, run);
  const target =
    result.lessonJump === null
      ? undefined
      : course.lessons.find((lesson) => lesson.id === result.lessonJump);
  const scored = block.passScore !== undefined || result.maxScore > 0;
  return (
    <div role="status" className="flex flex-col gap-2">
      {result.ending ? (
        <>
          <p className="text-small font-medium text-muted">{OUTCOMES[result.ending.outcome]}</p>
          <h3 className="text-h3 text-fg">{result.ending.title}</h3>
          <RichTextView value={result.ending.text} course={course} go={go} />
        </>
      ) : (
        !target && <p className="text-body text-fg">The scenario has ended.</p>
      )}
      {scored && (
        <p className="text-body text-fg">
          Your score: {result.score} of {result.maxScore} points.
        </p>
      )}
      {result.passed !== null && (
        <p className="text-body text-fg">
          {result.passed ? 'You passed.' : "You didn't pass this time."} The pass score is{' '}
          {block.passScore} points.
        </p>
      )}
      {target && (
        <Button
          variant="secondary"
          onClick={() => go({ kind: 'lesson', lessonId: target.id })}
          className="self-start"
        >
          Go to {target.title}
        </Button>
      )}
    </div>
  );
}

/** "You've finished this scenario." and the best score, from the learner's progress. */
function finishedLine(run: ScenarioProgress): string {
  const best = run.maxScore > 0 ? ` Your best score is ${run.bestScore} of ${run.maxScore}.` : '';
  return `You've finished this scenario.${best}`;
}
