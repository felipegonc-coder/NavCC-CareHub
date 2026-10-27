import { resolve } from 'node:path';
import { z } from 'zod';

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

export type FilesSettings = z.infer<typeof filesSettingsSchema>;

/** Files settings from the environment; empty values count as unset. Throws on invalid values. */
export function readFilesSettings(
  env: Record<string, string | undefined> = process.env,
): FilesSettings {
  const values = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = filesSettingsSchema.safeParse(values);
  if (!result.success) throw new Error(`Invalid files settings:\n${z.prettifyError(result.error)}`);
  return result.data;
}
