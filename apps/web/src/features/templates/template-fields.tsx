import {
  STARTER_CATEGORIES,
  TEMPLATE_LIMITS,
  WORKSPACE_CATEGORY,
  type TemplateAudience,
} from '@carehub/extras/templates/gallery';
import type { TemplateSpace } from '@carehub/extras/templates/schemas';
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@carehub/ui';
import { useId } from 'react';
import { ApiError } from '../../lib/api';

// Form parts shared by Save as template and the card menu's dialogs (spec 2).

const EVERYONE = 'everyone';
const ONLY_ME = 'me';
const SPACE = 'space:';

/** Who can use it, as a Select value: "everyone", "me" or "space:<id>". */
export function audienceValue(audience: TemplateAudience): string {
  if (audience.type === 'space') return `${SPACE}${audience.spaceId}`;
  return audience.type === 'me' ? ONLY_ME : EVERYONE;
}

/** The Select value back as an audience. */
export function audienceFrom(value: string): TemplateAudience {
  if (value.startsWith(SPACE)) return { type: 'space', spaceId: value.slice(SPACE.length) };
  return value === ONLY_ME ? { type: 'me' } : { type: 'everyone' };
}

/**
 * Everyone in the workspace, then Members of each space the person is in. "Only me" and a space
 * they aren't in show only when the template already has them, so the current choice stays.
 */
export function audienceChoices(
  spaces: readonly TemplateSpace[],
  current: TemplateAudience = { type: 'everyone' },
): { value: string; label: string }[] {
  const choices = [
    { value: EVERYONE, label: 'Everyone in the workspace' },
    ...spaces.map((space) => ({ value: `${SPACE}${space.id}`, label: `Members of ${space.name}` })),
  ];
  if (current.type === 'me') choices.push({ value: ONLY_ME, label: 'Only me' });
  if (current.type === 'space' && !spaces.some((space) => space.id === current.spaceId)) {
    const name = current.spaceName ?? 'a space you aren’t in';
    choices.push({ value: audienceValue(current), label: `Members of ${name}` });
  }
  return choices;
}

/** Categories to pick from: Care Hub's, then the ones people here made up. */
export function categoryChoices(categories: readonly string[]): string[] {
  const own = categories.filter((name) => name !== WORKSPACE_CATEGORY);
  return [...new Set<string>([...STARTER_CATEGORIES, ...own])];
}

/** What to say when a change fails: the server's words, or a general line. */
export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export function NameFields({
  name,
  description,
  onName,
  onDescription,
  error,
}: {
  name: string;
  description: string;
  onName(value: string): void;
  onDescription(value: string): void;
  error?: string | undefined;
}) {
  return (
    <>
      <Field label="Name" required error={error}>
        <Input
          value={name}
          maxLength={TEMPLATE_LIMITS.name}
          onChange={(event) => onName(event.target.value)}
        />
      </Field>
      <Field label="Description" hint="One line for the gallery card.">
        <Input
          value={description}
          maxLength={TEMPLATE_LIMITS.description}
          onChange={(event) => onDescription(event.target.value)}
        />
      </Field>
    </>
  );
}

/** Pick a category or type a new one. */
export function CategoryField({
  value,
  categories,
  onChange,
  error,
}: {
  value: string;
  categories: readonly string[];
  onChange(value: string): void;
  error?: string | undefined;
}) {
  const listId = useId();
  return (
    <Field label="Category" required hint="Pick one or type a new one." error={error}>
      <Input
        value={value}
        list={listId}
        maxLength={TEMPLATE_LIMITS.category}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {categoryChoices(categories).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Field>
  );
}

export function AudienceField({
  value,
  choices,
  onChange,
}: {
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <Field label="Who can use it">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
