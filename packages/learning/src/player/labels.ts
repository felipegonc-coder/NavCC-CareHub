import type { ContinueBlock, CourseSettings } from '../format/index';

/** The player words a course can rename (Course settings → labels). */
export type PlayerLabelKey = keyof NonNullable<CourseSettings['labels']>;
export type PlayerLabels = Record<PlayerLabelKey, string>;

/** The words the player uses when a course doesn't rename them. */
export const DEFAULT_PLAYER_LABELS: Readonly<PlayerLabels> = {
  start: 'Start course',
  continue: 'Continue',
  next: 'Next lesson',
  complete: 'Complete lesson',
  submit: 'Submit',
  retry: 'Try again',
};

const LABEL_KEYS = Object.keys(DEFAULT_PLAYER_LABELS) as PlayerLabelKey[];

/** The course's button words: its renamed labels (trimmed; blank ones ignored) on top of the defaults. */
export function playerLabels(course: { settings: Pick<CourseSettings, 'labels'> }): PlayerLabels {
  const renamed = course.settings.labels;
  const labels: PlayerLabels = { ...DEFAULT_PLAYER_LABELS };
  for (const key of LABEL_KEYS) {
    const value = renamed?.[key]?.trim();
    if (value) labels[key] = value;
  }
  return labels;
}

/** The words on a continue block: its own label if it has one, otherwise the course's "continue" label. */
export function continueBlockLabel(
  block: Pick<ContinueBlock, 'label'>,
  labels: Pick<PlayerLabels, 'continue'>,
): string {
  return block.label?.trim() || labels.continue;
}
