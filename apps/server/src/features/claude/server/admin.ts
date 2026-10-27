import { CLAUDE_FEATURES, claudeSwitchKey, type ClaudeFeature } from '@carehub/extras/claude';
import {
  CLAUDE_CHAT_RETENTION_KEY,
  CLAUDE_MONTHLY_LIMIT_KEY,
  chatRetentionSchema,
  NAV_OK_REQUIRED,
  turnsSwitchOn,
  type ClaudeSettingsUpdate,
  type ClaudeSettingsView,
  type ClaudeStatus,
} from '@carehub/extras/claude/settings';
import { httpError } from '../../../core/errors';
import type { Db, Tx } from '../../../db';
import { claudeFeaturesOn, monthlyLimitFrom } from './ask';
import { claudeHttpError } from './errors';
import { claudeMemberOf } from './members';
import { claudeRuntime } from './runtime';
import { capMonth, requestsThisMonthByFeature } from './usage';
import { claudeSettingChanges, getClaudeSettings, setWorkspaceSetting } from './workspace-settings';

// Settings → Claude (docs/extras/claude.md): what Admins see and change, and the on/off status the
// web app asks for.

function perFeature<T>(value: (feature: ClaudeFeature) => T): Record<ClaudeFeature, T> {
  return Object.fromEntries(CLAUDE_FEATURES.map((feature) => [feature, value(feature)])) as Record<
    ClaudeFeature,
    T
  >;
}

const SWITCH_KEYS: ReadonlySet<string> = new Set(CLAUDE_FEATURES.map(claudeSwitchKey));

/**
 * What a setting is when the workspace never saved it: off; for chats, kept until deleted (CL-D3);
 * for the monthly limit, the server's default (CL-D2).
 */
function unsaved(key: string): unknown {
  if (key === CLAUDE_CHAT_RETENTION_KEY) return null;
  if (key === CLAUDE_MONTHLY_LIMIT_KEY) return claudeRuntime().settings().monthlyRequests;
  return false;
}

/** GET /api/claude/settings. Says whether the server has the key, never what it is. */
export async function claudeSettingsView(
  db: Db | Tx,
  workspaceId: string,
): Promise<ClaudeSettingsView> {
  const { settings, now } = claudeRuntime();
  const server = settings();
  const at = now();
  const saved = await getClaudeSettings(db, workspaceId);
  const changes = await claudeSettingChanges(db, workspaceId);
  const used = await requestsThisMonthByFeature(db, workspaceId, at);
  const retention = chatRetentionSchema.safeParse(saved.get(CLAUDE_CHAT_RETENTION_KEY) ?? null);
  return {
    keySet: Boolean(server.apiKey),
    model: server.model,
    switches: perFeature((feature) => saved.get(claudeSwitchKey(feature)) === true),
    lastChanged: perFeature((feature) => {
      const change = changes.get(claudeSwitchKey(feature));
      return change ? { by: change.by, at: change.at.toISOString() } : null;
    }),
    chatRetentionDays: retention.success ? retention.data : null,
    usage: {
      month: capMonth(at),
      requests: [...used.values()].reduce((sum, n) => sum + n, 0),
      monthlyRequests: monthlyLimitFrom(
        saved.get(CLAUDE_MONTHLY_LIMIT_KEY),
        server.monthlyRequests,
      ),
      byFeature: perFeature((feature) => used.get(feature) ?? 0),
    },
  };
}

/** The security log (decision 0007): one line per change, with who and what, never a key. */
export interface ClaudeSecurityLog {
  info(details: { security: Record<string, unknown> }, message: string): void;
}

export interface ClaudeSettingsChange {
  workspaceId: string;
  userId: string;
  update: ClaudeSettingsUpdate;
  log: ClaudeSecurityLog;
}

/**
 * PUT /api/claude/settings: saves what differs from what's saved, in one transaction, and logs each
 * change once it's saved. Answers with the settings as they are now.
 *
 * A switch turns on only when the server has the key (409 not_set_up otherwise, sending nothing)
 * and the Admin ticked "Nav has given the OK" in its confirm (`navOk`, 400 otherwise).
 */
export async function updateClaudeSettings(
  db: Db,
  change: ClaudeSettingsChange,
): Promise<ClaudeSettingsView> {
  const { workspaceId, userId, update, log } = change;
  if (turnsSwitchOn(update)) {
    if (!claudeRuntime().settings().apiKey) throw claudeHttpError('not_set_up');
    if (update.navOk !== true) throw httpError(400, 'invalid', NAV_OK_REQUIRED);
  }
  const wanted = new Map<string, unknown>();
  for (const feature of CLAUDE_FEATURES) {
    const on = update.switches?.[feature];
    if (on !== undefined) wanted.set(claudeSwitchKey(feature), on);
  }
  if (update.monthlyRequests !== undefined) {
    wanted.set(CLAUDE_MONTHLY_LIMIT_KEY, update.monthlyRequests);
  }
  if (update.chatRetentionDays !== undefined) {
    wanted.set(CLAUDE_CHAT_RETENTION_KEY, update.chatRetentionDays);
  }

  const changed = await db.transaction(async (tx) => {
    const saved = await getClaudeSettings(tx, workspaceId);
    const changes: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of wanted) {
      const before = saved.has(key) ? saved.get(key) : unsaved(key);
      if (before === value) continue;
      await setWorkspaceSetting(tx, workspaceId, key, value, userId);
      changes.push({ key, value });
    }
    return changes;
  });
  for (const { key, value } of changed) {
    // A switch turned on records that its confirm had "Nav has given the OK" ticked.
    const confirmed = SWITCH_KEYS.has(key) && value === true ? { navOk: true } : {};
    // stand-in: the security log (S2) isn't on main yet; until then it's the app log, marked.
    log.info(
      {
        security: {
          event: 'claude.setting_changed',
          workspaceId,
          userId,
          key,
          value,
          ...confirmed,
        },
      },
      'Claude setting changed',
    );
  }
  return claudeSettingsView(db, workspaceId);
}

/**
 * GET /api/claude/status: which features the signed-in person can use in their workspace now. All
 * off for anyone who isn't a member or hasn't claude.use.
 */
export async function claudeStatusFor(db: Db | Tx, userId: string): Promise<ClaudeStatus> {
  const off = { on: perFeature(() => false) };
  const member = await claudeMemberOf(db, userId);
  if (!member) return off;
  if (!(await claudeRuntime().access.canUseClaude(db, member.workspaceId, userId))) return off;
  return { on: await claudeFeaturesOn(db, member.workspaceId) };
}
