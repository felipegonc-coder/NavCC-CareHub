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
  /** Uploads pause while less than this is free on the files' disk, in MB (Data settings DS-08). 0: never. */
  FILES_MIN_FREE_MB: z.coerce.number().int().min(0).max(1_048_576).default(2048),
});

export type FilesSettings = z.output<typeof filesSettingsSchema>;

/** The files settings (decision 0007, section 2.3). An invalid value is ignored with a warning. */
export const readFilesSettings = (log?: ReadSettingsOptions['log']): FilesSettings =>
  readSettings(filesSettingsSchema, { log });
