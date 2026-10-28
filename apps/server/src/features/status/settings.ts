// The Status page's own settings (decision 0007, section 2.3; listed in docs/team/settings.md).
import { z } from 'zod';
import { readSettings, type ReadSettingsOptions } from '../../core/settings';
import { BACKUP_TIME } from './domain/backups';
import { isTimeZone } from './domain/time';

const settingsSchema = z.object({
  /** The nightly backup time in TZ, the same setting the backup service reads. */
  BACKUP_AT: z.string().regex(BACKUP_TIME, 'Use a time like 02:00.').default('02:00'),
  /** The server's time zone: for backup times, and the uptime days of people signed out. */
  TZ: z
    .string()
    .refine(isTimeZone, 'Use a time zone name, such as America/Denver.')
    .default('America/Denver'),
  // CAREHUB_VERSION and CAREHUB_BUILD_DATE are core settings (config.ts, decision 0007, section
  // 2.3) that the image build sets. Features can't reach the app's config, so they're read here too.
  /** The running version, as in config.ts. */
  CAREHUB_VERSION: z.string().min(1).default('0.0.0-dev'),
  /** When the image was built, such as 2026-10-27T08:00:00Z. Unset shows "Not recorded". */
  CAREHUB_BUILD_DATE: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
  /** Uploaded files: the Status page checks that it can write there, and the free disk space. */
  FILES_DIR: z.string().min(1).optional(),
  /** Where the backup service writes runs/ and reads requests/ (deploy/README.md). */
  BACKUPS_DIR: z.string().min(1).default('/data/backups'),
});

export type StatusSettings = z.output<typeof settingsSchema>;

export function readStatusSettings(options?: ReadSettingsOptions): StatusSettings {
  return readSettings(settingsSchema, options);
}
