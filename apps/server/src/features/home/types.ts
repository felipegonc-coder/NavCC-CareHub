// Home settings (Home and reminders spec, section 4): what each person changed about their Home.
// The web app has its own copy of these types in apps/web/src/features/home/settings.ts.
import { z } from 'zod';

/** Home's sections, in the spec's order (section 2). */
export const HOME_SECTION_IDS = [
  'upcoming',
  'unread',
  'tasks',
  'reminders',
  'learning',
  'recent',
] as const;

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

/** One person's Home settings. Only they read or change them (HR-06). */
export interface HomeSettings {
  /** The sections hidden with Customize Home, each once, in Home's order. */
  hiddenSections: HomeSectionId[];
  /** Whether the sidebar's Upcoming heading is folded. */
  upcomingFolded: boolean;
}

/** Until a person changes something: every section shown and Upcoming open. */
export const DEFAULT_HOME_SETTINGS: Readonly<HomeSettings> = Object.freeze({
  hiddenSections: [],
  upcomingFolded: false,
});

/** The live event (to the person only) after their settings change, so their other tabs follow. */
export const HOME_SETTINGS_CHANGED = 'home-settings-changed';

/** The body of PATCH /api/home/settings: the settings to change. The others stay as they are. */
export const homeSettingsChangeSchema = z
  .strictObject({
    hiddenSections: z
      .array(z.enum(HOME_SECTION_IDS, { error: "That isn't a section of Home." }))
      .max(HOME_SECTION_IDS.length, { error: 'Each section can be hidden once.' })
      .optional(),
    upcomingFolded: z.boolean({ error: 'Folded is true or false.' }).optional(),
  })
  .refine((change) => change.hiddenSections !== undefined || change.upcomingFolded !== undefined, {
    error: 'Nothing to change.',
  });

export type HomeSettingsChange = z.infer<typeof homeSettingsChangeSchema>;

/** The sections once each, in Home's order. */
export function inHomeOrder(sections: readonly string[]): HomeSectionId[] {
  return HOME_SECTION_IDS.filter((id) => sections.includes(id));
}
