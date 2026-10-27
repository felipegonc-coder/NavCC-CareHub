import type { CourseSettings } from '../format/index';

// ---------- Outline sidebar ----------

/** The course's sidebar setting. Missing means "open". */
export type PlayerSidebarSetting = NonNullable<CourseSettings['sidebar']>;

/** How the outline shows: not at all, as a sidebar next to the lesson, or as a menu (phones). */
export type PlayerSidebar =
  { kind: 'none' } | { kind: 'sidebar'; open: boolean } | { kind: 'menu'; open: boolean };

/**
 * How the outline shows. "hidden" courses have no outline (people move with Previous and Next). On narrow screens
 * (the phone layout, under 768 px) the outline is a menu that starts closed; on wider screens a sidebar that starts open unless the course says
 * "closed". `userOpen` is the learner's own choice during this visit and wins over the course setting.
 */
export function playerSidebar(
  setting: PlayerSidebarSetting | undefined,
  options: { narrow: boolean; userOpen?: boolean | undefined },
): PlayerSidebar {
  if (setting === 'hidden') return { kind: 'none' };
  if (options.narrow) return { kind: 'menu', open: options.userOpen ?? false };
  return { kind: 'sidebar', open: options.userOpen ?? setting !== 'closed' };
}

// ---------- Text size ----------

/** Text size steps for the bigger-text option, smallest first. */
export const PLAYER_TEXT_SIZES = ['standard', 'large', 'larger', 'largest'] as const;
export type PlayerTextSize = (typeof PLAYER_TEXT_SIZES)[number];

/** Where the web app remembers the learner's text size on this device (localStorage). */
export const PLAYER_TEXT_SIZE_KEY = 'carehub.learning.textSize';

const TEXT_SCALE: Readonly<Record<PlayerTextSize, number>> = {
  standard: 1,
  large: 1.125,
  larger: 1.25,
  largest: 1.5,
};
const TEXT_SIZE_LABEL: Readonly<Record<PlayerTextSize, string>> = {
  standard: 'Standard',
  large: 'Large',
  larger: 'Larger',
  largest: 'Largest',
};

/** How much bigger lesson text is at this size: 1 (16 px body text), 1.125, 1.25 or 1.5 (24 px). */
export function playerTextScale(size: PlayerTextSize): number {
  return TEXT_SCALE[size];
}

/** The size's name for the text-size control, e.g. "Larger". */
export function playerTextSizeLabel(size: PlayerTextSize): string {
  return TEXT_SIZE_LABEL[size];
}

/** The next size up (`1`) or down (`-1`), or null at either end, so the control can disable its button. */
export function stepPlayerTextSize(size: PlayerTextSize, step: 1 | -1): PlayerTextSize | null {
  return PLAYER_TEXT_SIZES[PLAYER_TEXT_SIZES.indexOf(size) + step] ?? null;
}

/** A remembered text size (for example from localStorage); anything unknown means "standard". */
export function parsePlayerTextSize(value: unknown): PlayerTextSize {
  return PLAYER_TEXT_SIZES.find((size) => size === value) ?? 'standard';
}
