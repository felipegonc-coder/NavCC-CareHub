import {
  LIMITS,
  newId,
  type Course,
  type Id,
  type ScenarioBlock,
  type ScenarioChoice,
  type ScenarioScene,
} from '@carehub/learning';
import { Button, Field, Input, Textarea } from '@carehub/ui';
import { Plus } from 'lucide-react';
import { ChoiceButtons, withOptionalText } from '../../fields';
import { RichTextInput } from '../text/RichTextInput';
import { NativeSelect, WholeNumberInput, withRichText } from './fields';

type Ending = NonNullable<ScenarioScene['ending']>;

const OUTCOMES = [
  { value: 'great', label: 'Great' },
  { value: 'okay', label: 'Okay' },
  { value: 'poor', label: 'Poor' },
] as const;

const OPTIONAL = 'Optional.';

/** "Scene 2: The customer asks…": a scene's number and the start of its text, for lists. */
export function sceneLabel(scenes: readonly ScenarioScene[], id: Id): string {
  const index = scenes.findIndex((scene) => scene.id === id);
  const text = scenes[index]?.text.trim() ?? '';
  const start = text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  return start ? `Scene ${index + 1}: ${start}` : `Scene ${index + 1}`;
}

/** A choice's `next` as a select value: "scene:<id>", "retry" or "lesson:<id>". */
const nextValue = (next: ScenarioChoice['next']): string =>
  next.kind === 'retry'
    ? 'retry'
    : next.kind === 'scene'
      ? `scene:${next.sceneId}`
      : `lesson:${next.lessonId}`;

const nextFrom = (value: string): ScenarioChoice['next'] => {
  if (value.startsWith('scene:')) return { kind: 'scene', sceneId: value.slice(6) };
  if (value.startsWith('lesson:')) return { kind: 'lesson', lessonId: value.slice(7) };
  return { kind: 'retry' };
};

/** Props for {@link SceneEditor}. */
export type SceneEditorProps = {
  scene: ScenarioScene;
  index: number;
  block: ScenarioBlock;
  course: Course;
  lessonId: Id;
  onChange(next: ScenarioScene): void;
  onRemove(): void;
};

/**
 * One scene: who speaks, what happens, and the learner's choices; a scene with no choices is an
 * ending, with its outcome, title and text.
 */
export function SceneEditor(props: SceneEditorProps) {
  const { scene, index, block, course, onChange } = props;
  const name = `Scene ${index + 1}`;
  const choices = scene.choices;
  const setChoice = (next: ScenarioChoice) =>
    onChange({ ...scene, choices: choices.map((c) => (c.id === next.id ? next : c)) });
  const addChoice = () => {
    // The scene after this one, else any other scene, else trying again.
    const others = block.scenes.filter((s) => s.id !== scene.id);
    const target = block.scenes[index + 1] ?? others[0];
    const choice: ScenarioChoice = {
      id: newId(),
      text: '',
      points: 0,
      next: target ? { kind: 'scene', sceneId: target.id } : { kind: 'retry' },
    };
    // A scene with choices isn't an ending any more.
    const next: ScenarioScene = { ...scene, choices: [...choices, choice] };
    delete next.ending;
    onChange(next);
  };
  const ending: Ending = scene.ending ?? { outcome: 'okay', title: '' };
  const setEnding = (next: Ending) => onChange({ ...scene, ending: next });

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-border p-4">
      <legend className="px-1 text-small font-medium text-fg">
        {block.startSceneId === scene.id ? `${name} (the scenario starts here)` : name}
      </legend>
      <Field label={`Who speaks in ${name.toLowerCase()}`}>
        <NativeSelect
          value={scene.speakerId ?? ''}
          onChange={(e) => onChange(withOptionalText(scene, 'speakerId', e.currentTarget.value))}
        >
          <option value="">No one: it describes what happens</option>
          {block.characters.map((character, c) => (
            <option key={character.id} value={character.id}>
              {character.name.trim() || `Character ${c + 1}`}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={`What happens in ${name.toLowerCase()}`}>
        <Textarea
          rows={3}
          value={scene.text}
          maxLength={LIMITS.sceneText}
          onChange={(e) => onChange({ ...scene, text: e.currentTarget.value })}
        />
      </Field>
      {choices.length > 0 ? (
        <ol aria-label={`Choices in ${name.toLowerCase()}`} className="flex flex-col gap-3">
          {choices.map((choice, c) => (
            <li key={choice.id} className="flex flex-col gap-3 rounded bg-fill p-3">
              <ChoiceEditor
                {...props}
                choice={choice}
                number={c + 1}
                onChoice={setChoice}
                onRemoveChoice={() =>
                  onChange({ ...scene, choices: choices.filter((x) => x.id !== choice.id) })
                }
              />
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-col gap-3 rounded bg-fill p-3">
          <p className="text-small text-muted">
            A scene with no choices is an ending: the scenario stops here.
          </p>
          <ChoiceButtons
            label="Outcome"
            value={ending.outcome}
            options={OUTCOMES}
            onChange={(outcome) => setEnding({ ...ending, outcome })}
          />
          <Field label="Ending title">
            <Input
              value={ending.title}
              maxLength={LIMITS.title}
              onChange={(e) => setEnding({ ...ending, title: e.currentTarget.value })}
            />
          </Field>
          <Field label="Ending text" hint={OPTIONAL}>
            <RichTextInput
              ariaLabel="Ending text"
              value={ending.text ?? []}
              course={course}
              onChange={(text) => setEnding(withRichText(ending, 'text', text))}
            />
          </Field>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={choices.length >= LIMITS.scenarioChoices}
          onClick={addChoice}
        >
          <Plus aria-hidden />
          Add choice
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onRemove}>
          Remove {name.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  );
}

type ChoiceEditorProps = SceneEditorProps & {
  choice: ScenarioChoice;
  number: number;
  onChoice(next: ScenarioChoice): void;
  onRemoveChoice(): void;
};

/** One choice: its words, where it leads, its points and the coaching shown after it. */
function ChoiceEditor(props: ChoiceEditorProps) {
  const { choice, number, scene, block, course, lessonId, onChoice } = props;
  const value = nextValue(choice.next);
  const scenes = block.scenes.filter((s) => s.id !== scene.id);
  const lessons = course.lessons.filter((lesson) => lesson.id !== lessonId);
  const known =
    value === 'retry' ||
    scenes.some((s) => value === `scene:${s.id}`) ||
    lessons.some((lesson) => value === `lesson:${lesson.id}`);
  return (
    <>
      <Field label={`Choice ${number}`}>
        <Input
          value={choice.text}
          maxLength={LIMITS.shortText}
          onChange={(e) => onChoice({ ...choice, text: e.currentTarget.value })}
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={`Where choice ${number} leads`}>
          <NativeSelect
            value={known ? value : ''}
            onChange={(e) => {
              const next = nextFrom(e.currentTarget.value);
              // A choice to try again can't give points (publish checks).
              const points = next.kind === 'retry' ? Math.min(choice.points, 0) : choice.points;
              onChoice({ ...choice, next, points });
            }}
          >
            {!known && (
              <option value="" disabled>
                Choose where it leads
              </option>
            )}
            {scenes.length > 0 && (
              <optgroup label="Scenes">
                {scenes.map((s) => (
                  <option key={s.id} value={`scene:${s.id}`}>
                    {sceneLabel(block.scenes, s.id)}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="retry">Try again: back to this scene's choices</option>
            {lessons.length > 0 && (
              <optgroup label="Other lessons">
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={`lesson:${lesson.id}`}>
                    {lesson.title}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
        </Field>
        <Field
          label={`Points for choice ${number}`}
          hint={
            choice.next.kind === 'retry'
              ? 'From -10 to 0: a choice to try again can be picked again and again.'
              : 'From -10 to 10.'
          }
        >
          <WholeNumberInput
            value={choice.points}
            min={-LIMITS.choicePoints}
            max={choice.next.kind === 'retry' ? 0 : LIMITS.choicePoints}
            onChange={(points) => onChoice({ ...choice, points })}
          />
        </Field>
      </div>
      <Field label={`Coaching for choice ${number}`} hint="Optional. Shown after the choice.">
        <RichTextInput
          ariaLabel={`Coaching for choice ${number}`}
          value={choice.coaching ?? []}
          course={course}
          onChange={(coaching) => onChoice(withRichText(choice, 'coaching', coaching))}
        />
      </Field>
      <Button size="sm" variant="ghost" className="self-start" onClick={props.onRemoveChoice}>
        Remove choice {number}
      </Button>
    </>
  );
}
