import { z } from 'zod';

export interface ReadSettingsOptions {
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Where to say that a value was ignored, for example `app.log`. Defaults to the console. */
  log?: { warn(message: string): void };
}

/**
 * Reads a feature's own settings from environment variables with a zod object schema (decision
 * 0007, section 2.3). Give every setting `.optional()` or `.default()`.
 *
 * - An empty value counts as unset.
 * - A missing optional setting comes back `undefined`, so the feature can switch itself off with a
 *   plain message, for example "Google sign-in isn't set up yet."
 * - An invalid value is ignored with a warning that never shows the value, and counts as unset.
 * - It never throws, so a setting can't stop the server.
 */
export function readSettings<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  { env = process.env, log = console }: ReadSettingsOptions = {},
): z.output<z.ZodObject<Shape>> {
  const settings: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const value = env[key] === '' ? undefined : env[key];
    let result = z.safeParse(field, value);
    if (!result.success && value !== undefined) {
      const reason = result.error.issues[0]?.message ?? 'not a valid value';
      log.warn(`${key} isn't valid, so it counts as unset: ${reason}`);
      result = z.safeParse(field, undefined);
    }
    if (result.success && result.data !== undefined) settings[key] = result.data;
  }
  return settings as z.output<z.ZodObject<Shape>>;
}
