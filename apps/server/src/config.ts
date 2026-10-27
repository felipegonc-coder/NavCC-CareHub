import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// src/ (source) and dist/ (bundle) sit at the same depth, so this is apps/web/dist in both.
const defaultWebDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

/** An IP address or a CIDR range, such as 172.31.250.2 or 10.0.0.0/8. */
function isAddressOrRange(entry: string): boolean {
  const [address = '', bits, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (version === 4 ? 32 : 128);
}

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
  /**
   * The reverse proxy (Caddy) whose X-Forwarded-For, -Proto and -Host headers are believed: an IP
   * address, a CIDR range or a comma-separated list. Unset: none, so the client is the connection.
   */
  TRUST_PROXY: z
    .string()
    .transform((value) => value.split(',').map((entry) => entry.trim()))
    .refine(
      (entries) => entries.every(isAddressOrRange),
      'Set TRUST_PROXY to IP addresses or CIDR ranges, separated by commas, such as 172.31.250.2.',
    )
    .optional(),
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
