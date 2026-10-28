import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { webAddressProblem } from './core/links';

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
  /**
   * The web address people use, for example https://carehub.example.test: just the address, with
   * nothing after it. Stored as its origin (no slash at the end), it starts every link Care Hub
   * makes (core/links.ts), and requests from other origins are refused.
   */
  CAREHUB_PUBLIC_URL: z
    .url({
      protocol: /^https?$/,
      error: 'Set CAREHUB_PUBLIC_URL to a web address like https://carehub.example.test.',
    })
    .superRefine((value, ctx) => {
      const problem = webAddressProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .transform((value) => new URL(value.trim()).origin)
    .optional(),
  /** Secure cookies (only sent over HTTPS). Turn off only for local development over plain HTTP. */
  COOKIE_SECURE: z.stringbool().default(true),
});

/** Server settings, read from environment variables. */
export type Config = z.infer<typeof configSchema>;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

// In production a missing or wrong setting mustn't quietly drop the Origin check or Secure cookies.
// Plain http is allowed only on this machine (localhost), for trying a production build.
const checkedConfigSchema = configSchema.superRefine((config, ctx) => {
  if (config.NODE_ENV !== 'production') return;
  const url = config.CAREHUB_PUBLIC_URL ? new URL(config.CAREHUB_PUBLIC_URL) : null;
  const local = url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url?.protocol !== 'https:' && !local) {
    ctx.addIssue({
      code: 'custom',
      path: ['CAREHUB_PUBLIC_URL'],
      message: 'In production, set CAREHUB_PUBLIC_URL to the https:// address people use.',
    });
  }
  if (!config.COOKIE_SECURE && !local) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'In production, COOKIE_SECURE=false works only with an http://localhost address.',
    });
  }
});

/** Reads settings from `env`; empty values count as unset. Throws on invalid values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const values = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = checkedConfigSchema.safeParse(values);
  if (!result.success) {
    throw new Error(`Invalid server settings:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
