// A space's settings as its owners and Admins change them (Sidebar spec, section 3.3): read from
// what the server sends, with safe defaults, and changed a few fields at a time.
import type { PageIcon, SpaceAccess, SpaceKind } from './types';

/** The security switches. A space can only turn off what the workspace allows. */
export const SECURITY_SWITCHES = ['shareLinks', 'guests', 'export', 'moveOut'] as const;
export type SecuritySwitch = (typeof SECURITY_SWITCHES)[number];
export type Switches = Record<SecuritySwitch, boolean>;

/** Who may add pages at the top level of the space. */
export type TopLevel = 'members' | 'owners';

export interface SpaceSettings {
  id: string;
  kind: SpaceKind;
  name: string;
  icon: PageIcon | null;
  description: string;
  defaultAccess: SpaceAccess;
  topLevel: TopLevel;
  security: Switches;
  /** What the workspace allows; a switch it turns off stays off here. */
  workspaceAllows: Switches;
  /** Owners and Admins; everyone else only sees that they can't change it. */
  canManage: boolean;
}

export interface SpaceChange {
  name?: string | undefined;
  icon?: PageIcon | null | undefined;
  description?: string | undefined;
  kind?: SpaceKind | undefined;
  defaultAccess?: SpaceAccess | undefined;
  topLevel?: TopLevel | undefined;
  security?: Partial<Switches> | undefined;
}

const KINDS: readonly SpaceKind[] = ['open', 'closed', 'private'];
const LEVELS: readonly SpaceAccess[] = ['full', 'edit', 'comment', 'view'];

const pick = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T =>
  choices.find((choice) => choice === value) ?? fallback;

function switchesOf(value: unknown, fallback: Switches): Switches {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const out = { ...fallback };
  for (const key of SECURITY_SWITCHES) {
    const on = raw[key];
    if (typeof on === 'boolean') out[key] = on;
  }
  return out;
}

const ALL_ON: Switches = { shareLinks: true, guests: true, export: true, moveOut: true };

/** The settings in a `GET /api/spaces/:id` reply, or null when it has no space. */
export function settingsOf(data: unknown): SpaceSettings | null {
  const reply = (typeof data === 'object' && data !== null ? data : {}) as { space?: unknown };
  const raw = (reply.space ?? reply) as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const allows = switchesOf(raw.workspaceAllows, ALL_ON);
  const security = switchesOf(raw.security, allows);
  for (const key of SECURITY_SWITCHES) security[key] &&= allows[key];
  return {
    id: raw.id,
    kind: pick(KINDS, raw.kind, 'open'),
    name: raw.name,
    icon: (raw.icon ?? null) as PageIcon | null,
    description: typeof raw.description === 'string' ? raw.description : '',
    defaultAccess: pick(LEVELS, raw.defaultAccess, 'edit'),
    topLevel: raw.topLevel === 'owners' ? 'owners' : 'members',
    security,
    workspaceAllows: allows,
    canManage: raw.canManage === true,
  };
}

/** The settings with the change made. */
export function applyChange(settings: SpaceSettings, change: SpaceChange): SpaceSettings {
  const { security, ...fields } = change;
  const next = { ...settings, security: { ...settings.security, ...security } };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

/** The change that puts back what `change` changed, from the settings before it. */
export function undoOf(before: SpaceSettings, change: SpaceChange): SpaceChange {
  const back: SpaceChange = {};
  if (change.name !== undefined) back.name = before.name;
  if (change.icon !== undefined) back.icon = before.icon;
  if (change.description !== undefined) back.description = before.description;
  if (change.kind !== undefined) back.kind = before.kind;
  if (change.defaultAccess !== undefined) back.defaultAccess = before.defaultAccess;
  if (change.topLevel !== undefined) back.topLevel = before.topLevel;
  const asked = change.security;
  if (asked) {
    const security: Partial<Switches> = {};
    for (const key of SECURITY_SWITCHES) {
      if (asked[key] !== undefined) security[key] = before.security[key];
    }
    back.security = security;
  }
  return back;
}
