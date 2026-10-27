import {
  LIMITS,
  newId,
  scenarioMaxScore,
  type Id,
  type ScenarioBlock,
  type ScenarioScene,
} from '@carehub/learning';
import { Button, Field, Input } from '@carehub/ui';
import { Plus } from 'lucide-react';
import { ImageField } from '../../../media';
import { withOptionalText } from '../../fields';
import type { BlockEditorProps } from '../registry';
import { RichTextInput } from '../text/RichTextInput';
import { NativeSelect, WholeNumberInput, withRichText } from './fields';
import { SceneEditor, sceneLabel } from './SceneEditor';

type Character = ScenarioBlock['characters'][number];

/**
 * Scenario: a title and introduction, the characters, and the scenes with the learner's choices.
 * An optional pass score turns the choices' points into a pass or a fail.
 */
export function ScenarioEditor(props: BlockEditorProps<ScenarioBlock>) {
  const { block, onChange, course } = props;
  const { characters, scenes } = block;
  const best = scenarioMaxScore(block);
  const knownStart = scenes.some((scene) => scene.id === block.startSceneId);

  const setCharacter = (next: Character) =>
    onChange({ ...block, characters: characters.map((c) => (c.id === next.id ? next : c)) });
  const removeCharacter = (id: Id) =>
    onChange({
      ...block,
      characters: characters.filter((c) => c.id !== id),
      // Their scenes say what happens instead.
      scenes: scenes.map((scene) =>
        scene.speakerId === id ? withOptionalText(scene, 'speakerId', '') : scene,
      ),
    });
  const setScene = (next: ScenarioScene) =>
    onChange({ ...block, scenes: scenes.map((s) => (s.id === next.id ? next : s)) });
  const addScene = () => {
    const scene: ScenarioScene = { id: newId(), text: '', choices: [] };
    onChange({
      ...block,
      scenes: [...scenes, scene],
      startSceneId: knownStart ? block.startSceneId : scene.id,
    });
  };
  const removeScene = (id: Id) => {
    const rest = scenes.filter((s) => s.id !== id);
    const start = block.startSceneId === id ? rest[0]?.id : undefined;
    onChange({ ...block, scenes: rest, startSceneId: start ?? block.startSceneId });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Scenario title">
        <Input
          value={block.title}
          maxLength={LIMITS.title}
          onChange={(e) => onChange({ ...block, title: e.currentTarget.value })}
        />
      </Field>
      <Field label="Introduction" hint="Optional. Shown before the learner starts.">
        <RichTextInput
          ariaLabel="Introduction"
          value={block.intro ?? []}
          course={course}
          onChange={(intro) => onChange(withRichText(block, 'intro', intro))}
        />
      </Field>
      <Field
        label="Pass score"
        hint={`Optional. Learners pass when their choices add up to at least this many points. The best possible score is ${best}.`}
      >
        <WholeNumberInput
          value={block.passScore}
          min={-LIMITS.scenarioPassScore}
          max={LIMITS.scenarioPassScore}
          onChange={(passScore) => onChange({ ...block, passScore })}
          onClear={() => {
            const next = { ...block };
            delete next.passScore;
            onChange(next);
          }}
        />
      </Field>

      <section aria-label="Characters" className="flex flex-col gap-3">
        <h3 className="text-small font-medium text-fg">Characters</h3>
        {characters.length > 0 && (
          <ol className="flex flex-col gap-3">
            {characters.map((character, index) => (
              <li
                key={character.id}
                className="flex flex-col gap-3 rounded border border-border p-4"
              >
                <Field label={`Character ${index + 1} name`}>
                  <Input
                    value={character.name}
                    maxLength={LIMITS.title}
                    onChange={(e) => setCharacter({ ...character, name: e.currentTarget.value })}
                  />
                </Field>
                <Field label={`Character ${index + 1} role`} hint="Optional, for example Customer.">
                  <Input
                    value={character.role ?? ''}
                    maxLength={LIMITS.title}
                    onChange={(e) =>
                      setCharacter(withOptionalText(character, 'role', e.currentTarget.value))
                    }
                  />
                </Field>
                <ImageField
                  label={`Picture of character ${index + 1}`}
                  value={character.avatar}
                  courseId={course.id}
                  caption={false}
                  aspect="1:1"
                  onChange={(avatar) => {
                    const next = { ...character, avatar };
                    if (!avatar) delete next.avatar;
                    setCharacter(next);
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => removeCharacter(character.id)}
                >
                  Remove character {index + 1}
                </Button>
              </li>
            ))}
          </ol>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={characters.length >= LIMITS.scenarioCharacters}
          onClick={() =>
            onChange({ ...block, characters: [...characters, { id: newId(), name: '' }] })
          }
        >
          <Plus aria-hidden />
          Add character
        </Button>
      </section>

      <section aria-label="Scenes" className="flex flex-col gap-3">
        <h3 className="text-small font-medium text-fg">Scenes</h3>
        {scenes.length > 0 ? (
          <Field label="The scenario starts at">
            <NativeSelect
              value={knownStart ? block.startSceneId : ''}
              onChange={(e) => onChange({ ...block, startSceneId: e.currentTarget.value })}
            >
              {!knownStart && (
                <option value="" disabled>
                  Choose the first scene
                </option>
              )}
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {sceneLabel(scenes, scene.id)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          <p className="text-small text-muted">No scenes yet. Add the first one.</p>
        )}
        {scenes.map((scene, index) => (
          <SceneEditor
            key={scene.id}
            {...props}
            scene={scene}
            index={index}
            onChange={setScene}
            onRemove={() => removeScene(scene.id)}
          />
        ))}
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={scenes.length >= LIMITS.scenarioScenes}
          onClick={addScene}
        >
          <Plus aria-hidden />
          Add scene
        </Button>
      </section>
    </div>
  );
}
