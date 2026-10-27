import type { Db, Tx } from '../../../db';
import { readClaudeSettings, type ClaudeSettings } from './settings';
import { getWorkspaceSetting } from './workspace-settings';

/** All the client ever logs: Anthropic's status (0 when nothing came back) and an error type. */
export interface ClaudeLogDetails {
  claude: { status: number; type: string };
}

export interface ClaudeLog {
  warn(details: ClaudeLogDetails, message: string): void;
}

/** What Claude needs from other lanes before anything is sent. */
export interface ClaudeAccess {
  /** Whether a workspace setting is on: `claude.navApproved` or a switch such as `claude.writing_help`. */
  isSettingOn(db: Db | Tx, workspaceId: string, key: string): Promise<boolean>;
  /** Whether the person has `claude.use` in the workspace. Guests never do. */
  canUseClaude(db: Db | Tx, workspaceId: string, userId: string): Promise<boolean>;
}

/** What Claude needs from the page model (#49) before it sends anything from a page. */
export interface ClaudePages {
  /** Whether the person can open the page in that workspace. A page in Trash counts as closed. */
  canOpenPage(db: Db | Tx, workspaceId: string, userId: string, pageId: string): Promise<boolean>;
}

export interface ClaudeRuntime {
  settings: () => ClaudeSettings;
  access: ClaudeAccess;
  pages: ClaudePages;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  log: ClaudeLog;
  now: () => Date;
}

// The switches and the OK are what Admins save in Settings → Claude (server/workspace-settings.ts).
// stand-in: roles (#55) aren't on main yet. Until they're bound, nobody has claude.use, so nothing
// is ever sent.
const standInAccess: ClaudeAccess = {
  isSettingOn: async (db, workspaceId, key) =>
    (await getWorkspaceSetting(db, workspaceId, key)) === true,
  canUseClaude: async () => false,
};

// stand-in: the page model's getPageAccess (#49). Until it's bound, no page can be opened.
const standInPages: ClaudePages = { canOpenPage: async () => false };

let settingsFromEnv: ClaudeSettings | undefined;

const defaults: ClaudeRuntime = {
  settings: () => (settingsFromEnv ??= readClaudeSettings()),
  access: standInAccess,
  pages: standInPages,
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: { warn: (details, message) => console.warn(message, JSON.stringify(details)) },
  now: () => new Date(),
};

let current: ClaudeRuntime = defaults;

export function claudeRuntime(): ClaudeRuntime {
  return current;
}

/**
 * Replaces parts of Claude's runtime: the app binds its log, the roles PR binds canUseClaude, the
 * page model binds `pages`, and tests bind fakes. The returned function puts back what was there
 * before.
 */
export function configureClaude(next: Partial<ClaudeRuntime>): () => void {
  const previous = current;
  current = { ...current, ...next };
  return () => {
    current = previous;
  };
}
