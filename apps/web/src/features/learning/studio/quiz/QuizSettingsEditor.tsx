import { LIMITS } from '@carehub/learning';
import type { QuizSettings, QuizSettingsPatch } from '@carehub/learning';
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@carehub/ui';

/** Props for {@link QuizSettingsEditor}. `questionCount` is the quiz's own questions, for the pool size. */
export type QuizSettingsEditorProps = {
  settings: QuizSettings;
  questionCount: number;
  onChange(patch: QuizSettingsPatch): void;
};

const REVEAL: [QuizSettings['revealAnswers'], string][] = [
  ['after_each_attempt', 'After each try'],
  ['after_passing', 'Once they pass'],
  ['after_final_attempt', 'After their last try'],
  ['never', 'Never'],
];

const DEFAULT_TRIES = 3;

function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <Field layout="inline" label={props.label} hint={props.hint}>
      <Switch checked={props.checked} onCheckedChange={props.onChange} />
    </Field>
  );
}

function NumberField(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <Field label={props.label} hint={props.hint} className="max-w-60">
      <Input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value)) props.onChange(value);
        }}
      />
    </Field>
  );
}

/** A quiz's settings: survey or graded, pass mark, tries, when answers are shown, shuffling and the question pool. */
export function QuizSettingsEditor({ settings, questionCount, onChange }: QuizSettingsEditorProps) {
  const survey = settings.mode === 'survey';
  const poolMax = Math.max(1, questionCount);
  return (
    <div className="flex flex-col gap-4">
      <Toggle
        label="This is a survey"
        hint="No right answers, score or pass mark. People answer once, and only single and multiple answer questions can be used."
        checked={survey}
        onChange={(on) => onChange({ mode: on ? 'survey' : null })}
      />
      {!survey && (
        <>
          <NumberField
            label="Pass mark (%)"
            value={settings.passMark}
            min={0}
            max={100}
            onChange={(passMark) => onChange({ passMark })}
          />
          <Toggle
            label="Unlimited tries"
            checked={settings.maxAttempts === null}
            onChange={(on) => onChange({ maxAttempts: on ? null : DEFAULT_TRIES })}
          />
          {settings.maxAttempts !== null && (
            <NumberField
              label="Number of tries"
              value={settings.maxAttempts}
              min={1}
              max={LIMITS.maxAttempts}
              onChange={(maxAttempts) => onChange({ maxAttempts })}
            />
          )}
          <Field label="Show the right answers" className="max-w-60">
            <Select
              value={settings.revealAnswers}
              onValueChange={(value) => {
                const reveal = REVEAL.find(([option]) => option === value);
                if (reveal) onChange({ revealAnswers: reveal[0] });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVEAL.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
      <Toggle
        label="Shuffle the questions"
        checked={settings.shuffleQuestions}
        onChange={(shuffleQuestions) => onChange({ shuffleQuestions })}
      />
      <Toggle
        label="Shuffle the answers"
        hint="Answer options and matching lists. True or false keeps its order."
        checked={settings.shuffleOptions}
        onChange={(shuffleOptions) => onChange({ shuffleOptions })}
      />
      <Toggle
        label="Use a question pool"
        hint="Each try uses only some of this quiz's own questions, picked at random."
        checked={settings.poolSize !== undefined}
        onChange={(on) => onChange({ poolSize: on ? poolMax : null })}
      />
      {settings.poolSize !== undefined && (
        <NumberField
          label="Questions per try"
          hint={`Out of ${questionCount} in this quiz. Questions from banks come on top.`}
          value={settings.poolSize}
          min={1}
          max={poolMax}
          onChange={(poolSize) => onChange({ poolSize })}
        />
      )}
    </div>
  );
}
