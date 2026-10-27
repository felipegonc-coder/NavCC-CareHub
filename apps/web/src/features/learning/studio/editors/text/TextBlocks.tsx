import { LIMITS } from '@carehub/learning';
import type { Block } from '@carehub/learning';
import { Field, Input, Textarea } from '@carehub/ui';
import type { JSX } from 'react';
import { ChoiceButtons, withOptionalText } from '../../fields';
import type { BlockEditorProps } from '../registry';
import { RichTextInput } from './RichTextInput';

/** The editor props for one block type. */
export type EditorOf<T extends Block['type']> = BlockEditorProps<Extract<Block, { type: T }>>;

const HEADING_SIZES = [
  { value: 1, label: 'Large' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Small' },
] as const;

const CALLOUT_TONES = [
  { value: 'note', label: 'Note' },
  { value: 'tip', label: 'Tip' },
  { value: 'warning', label: 'Warning' },
  { value: 'success', label: 'Success' },
] as const;

const DIVIDER_STYLES = [
  { value: 'line', label: 'Line' },
  { value: 'numbered', label: 'Number' },
  { value: 'spacer', label: 'Space' },
] as const;

const CONTINUE_RULES = [
  { value: 'click', label: 'People select the button' },
  { value: 'complete_above', label: 'Everything above is done' },
] as const;

const OPTIONAL = 'Optional.';

/** Heading: its size and text. */
export function HeadingEditor({ block, onChange }: EditorOf<'heading'>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <ChoiceButtons
        label="Size"
        value={block.level}
        options={HEADING_SIZES}
        onChange={(level) => onChange({ ...block, level })}
      />
      <Field label="Heading text">
        <Input
          value={block.text}
          maxLength={LIMITS.title}
          onChange={(e) => onChange({ ...block, text: e.currentTarget.value })}
        />
      </Field>
    </div>
  );
}

/** Paragraph: formatted text. */
export function ParagraphEditor({ block, onChange, course }: EditorOf<'paragraph'>): JSX.Element {
  return (
    <RichTextInput
      ariaLabel="Paragraph text"
      value={block.text}
      course={course}
      onChange={(text) => onChange({ ...block, text })}
    />
  );
}

/** Note: its kind (note, tip, warning, success), an optional title and the text. */
export function CalloutEditor({ block, onChange, course }: EditorOf<'callout'>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <ChoiceButtons
        label="Kind"
        value={block.tone}
        options={CALLOUT_TONES}
        onChange={(tone) => onChange({ ...block, tone })}
      />
      <Field label="Title" hint={OPTIONAL}>
        <Input
          value={block.title ?? ''}
          maxLength={LIMITS.title}
          onChange={(e) => onChange(withOptionalText(block, 'title', e.currentTarget.value))}
        />
      </Field>
      <Field label="Note text">
        <RichTextInput
          ariaLabel="Note text"
          value={block.text}
          course={course}
          onChange={(text) => onChange({ ...block, text })}
        />
      </Field>
    </div>
  );
}

/** Statement: one key line. */
export function StatementEditor({ block, onChange }: EditorOf<'statement'>): JSX.Element {
  return (
    <Field label="Statement">
      <Textarea
        rows={2}
        value={block.text}
        maxLength={LIMITS.statement}
        onChange={(e) => onChange({ ...block, text: e.currentTarget.value })}
      />
    </Field>
  );
}

/** Quote: the words and who said them. */
export function QuoteEditor({ block, onChange }: EditorOf<'quote'>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Quote">
        <Textarea
          rows={3}
          value={block.text}
          maxLength={LIMITS.longText}
          onChange={(e) => onChange({ ...block, text: e.currentTarget.value })}
        />
      </Field>
      <Field label="Who said it" hint={OPTIONAL}>
        <Input
          value={block.attribution ?? ''}
          maxLength={LIMITS.title}
          onChange={(e) => onChange(withOptionalText(block, 'attribution', e.currentTarget.value))}
        />
      </Field>
    </div>
  );
}

/** Two columns: text on the left and on the right (one under the other on phones). */
export function TwoColumnEditor({ block, onChange, course }: EditorOf<'two_column'>): JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Left column">
        <RichTextInput
          ariaLabel="Left column"
          value={block.left}
          course={course}
          onChange={(left) => onChange({ ...block, left })}
        />
      </Field>
      <Field label="Right column">
        <RichTextInput
          ariaLabel="Right column"
          value={block.right}
          course={course}
          onChange={(right) => onChange({ ...block, right })}
        />
      </Field>
    </div>
  );
}

/** Divider: a line, a section number or empty space. */
export function DividerEditor({ block, onChange }: EditorOf<'divider'>): JSX.Element {
  return (
    <ChoiceButtons
      label="Style"
      value={block.style}
      options={DIVIDER_STYLES}
      onChange={(style) => onChange({ ...block, style })}
    />
  );
}

/** Code: the snippet and its language. Learners see it; nothing runs. */
export function CodeEditor({ block, onChange }: EditorOf<'code'>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Language" hint="Optional, for example SQL or JSON.">
        <Input
          value={block.language ?? ''}
          maxLength={LIMITS.label}
          onChange={(e) => onChange(withOptionalText(block, 'language', e.currentTarget.value))}
        />
      </Field>
      <Field label="Code">
        <Textarea
          rows={6}
          spellCheck={false}
          className="font-mono"
          value={block.code}
          maxLength={LIMITS.code}
          onChange={(e) => onChange({ ...block, code: e.currentTarget.value })}
        />
      </Field>
    </div>
  );
}

/** Continue: hides the rest of the lesson until people select the button, or finish what is above. */
export function ContinueEditor({ block, onChange }: EditorOf<'continue'>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Button label" hint="Optional. Says “Continue” when empty.">
        <Input
          value={block.label ?? ''}
          maxLength={LIMITS.label}
          placeholder="Continue"
          onChange={(e) => onChange(withOptionalText(block, 'label', e.currentTarget.value))}
        />
      </Field>
      <ChoiceButtons
        label="The rest of the lesson shows when"
        value={block.requires}
        options={CONTINUE_RULES}
        onChange={(requires) => onChange({ ...block, requires })}
      />
    </div>
  );
}
