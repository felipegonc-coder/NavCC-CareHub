import { resolve } from 'node:path';
import { z } from 'zod';
import { readSettings, type ReadSettingsOptions } from '../../core/settings';

const filesSettingsSchema = z.object({
  /** Where uploaded files are kept (back it up with the database). */
  FILES_DIR: z
    .string()
    .min(1)
    .default('./data/files')
    .transform((dir) => resolve(dir)),
  /** The largest file allowed, in MB of 1,048,576 bytes (Data settings: 1 to 1,000; default 100). */
  FILES_MAX_MB: z.coerce.number().int().min(1).max(1000).default(100),
});

export type FilesSettings = z.output<typeof filesSettingsSchema>;

/** The files settings (decision 0007, section 2.3). An invalid value is ignored with a warning. */
export const readFilesSettings = (log?: ReadSettingsOptions['log']): FilesSettings =>
  readSettings(filesSettingsSchema, { log });
