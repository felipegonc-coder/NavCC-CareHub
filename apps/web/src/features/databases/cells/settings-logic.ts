/**
 * Property settings (spec 3.4): the choices for pickers, row pages and descriptions.
 */
import type { Property } from '@carehub/databases';
import { SETTINGS_TEXT } from './messages';

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** The choice a select's value names, or null. */
export function readChoice<T extends string>(
  choices: readonly Choice<T>[],
  value: string,
): T | null {
  return choices.find((choice) => choice.value === value)?.value ?? null;
}

export const ROW_PAGE_CHOICES: readonly Choice<Property['rowPage']>[] = [
  { value: 'always', label: SETTINGS_TEXT.rowPageChoices.always },
  { value: 'hide_when_empty', label: SETTINGS_TEXT.rowPageChoices.hide_when_empty },
  { value: 'always_hide', label: SETTINGS_TEXT.rowPageChoices.always_hide },
];

/** Characters in a property description (the server's request limit). */
export const DESCRIPTION_LIMIT = 280;
