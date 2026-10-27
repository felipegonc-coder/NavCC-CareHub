import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// src/ (source) and dist/ (bundle) sit at the same depth, so this is apps/web/dist in both.
const defaultWebDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

const configSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  WEB_DIST_DIR: z
    .string()
    .min(1)
    .default(defaultWebDistDir)
    .transform((dir) => resolve(dir)),
  CAREHUB_VERSION: z.string().min(1).default('0.0.0-dev'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** PostgreSQL, for example postgres://carehub@localhost:5432/carehub */
  DATABASE_URL: z
    .string({ error: 'Set DATABASE_URL to a postgres:// address.' })
    .regex(/^postgres(?:ql)?:\/\//, 'Set DATABASE_URL to a postgres:// address.'),
  /** The address people use, for example https://carehub.example.test. Requests from other origins are refused. */
  CAREHUB_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Secure cookies (only sent over HTTPS). Turn off only for local development over plain HTTP. */
  COOKIE_SECURE: z.stringbool().default(true),
});

/** Server settings, read from environment variables. */
export type Config = z.infer<typeof configSchema>;

/** Reads settings from `env`; empty values count as unset. Throws on invalid values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const values = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = configSchema.safeParse(values);
  if (!result.success) {
    throw new Error(`Invalid server settings:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
