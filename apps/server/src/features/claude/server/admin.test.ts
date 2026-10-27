import { randomUUID } from 'node:crypto';
import { claudeSettingsViewSchema } from '@carehub/extras/claude/settings';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import { claudeSettings } from '../schema';
import { claudeSettingsView, claudeStatusFor, updateClaudeSettings } from './admin';
import { isClaudeFeatureOn } from './ask';
import { bindClaudeMembers, type ClaudeMember } from './members';
import { claudeRuntime, configureClaude } from './runtime';
import { CLAUDE_MESSAGES_URL } from './settings';
import { recordUsage } from './usage';
import { getWorkspaceSetting } from './workspace-settings';

// Fictional people and key only.
const KEY = 'sk-ant-FICTIONAL-test-key-0003';
const NOW = new Date('2026-10-27T18:00:00Z');
const ALL_OFF = {
  writing_help: false,
  assistant: false,
  fields: false,
  meeting_summary: false,
  learning_help: false,
};
const NONE_USED = {
  writing_help: 0,
  assistant: 0,
  fields: 0,
  meeting_summary: 0,
  learning_help: 0,
};

describe.skipIf(!hasDatabase)('Settings → Claude', () => {
  let t: TestApp;
  let admin: TestUser;
  let editor: TestUser;
  const restores: Array<() => void> = [];
  const lines: Array<{ security: Record<string, unknown> }> = [];
  const log = {
    info: (details: { security: Record<string, unknown> }) => void lines.push(details),
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await createUser(t.db, { name: 'Avery Admin' });
    editor = await createUser(t.db, { name: 'Sam Editor' });
  });

  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
    lines.length = 0;
  });

  afterAll(async () => {
    await t?.close();
  });

  /** A workspace (new unless given): the server has the key, Avery is its Admin and Sam an Editor. */
  function setUp(options: { apiKey?: string; canUse?: boolean; workspaceId?: string } = {}) {
    const workspaceId = options.workspaceId ?? randomUUID();
    const members = new Map<string, ClaudeMember>([
      [admin.id, { workspaceId, isAdmin: true }],
      [editor.id, { workspaceId, isAdmin: false }],
    ]);
    restores.push(
      configureClaude({
        settings: () => ({
          apiKey: 'apiKey' in options ? options.apiKey : KEY,
          model: 'claude-test',
          monthlyRequests: 3000,
          url: CLAUDE_MESSAGES_URL,
        }),
        // The real switches (saved settings); only claude.use is a fake.
        access: { ...claudeRuntime().access, canUseClaude: async () => options.canUse ?? true },
        now: () => NOW,
      }),
      bindClaudeMembers(async (_db, userId) => members.get(userId) ?? null),
    );
    return workspaceId;
  }

  const change = (
    workspaceId: string,
    update: Parameters<typeof updateClaudeSettings>[1]['update'],
  ) => updateClaudeSettings(t.db, { workspaceId, userId: admin.id, update, log });

  it('starts with everything off, and never shows the key', async () => {
    const view = await claudeSettingsView(t.db, setUp());
    expect(view).toEqual({
      keySet: true,
      model: 'claude-test',
      navApproved: false,
      switches: ALL_OFF,
      chatRetentionDays: null,
      usage: { month: '2026-10', requests: 0, monthlyRequests: 3000, byFeature: NONE_USED },
    });
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect((await claudeSettingsView(t.db, setUp({ apiKey: undefined }))).keySet).toBe(false);
  });

  it('saves only what changed and logs each change once', async () => {
    const workspaceId = setUp();
    const view = await change(workspaceId, {
      navApproved: true,
      switches: { writing_help: true, assistant: false },
      chatRetentionDays: 90,
    });
    expect(view.navApproved).toBe(true);
    expect(view.switches).toEqual({ ...ALL_OFF, writing_help: true });
    expect(view.chatRetentionDays).toBe(90);
    expect(lines.map((line) => [line.security.key, line.security.value])).toEqual([
      ['claude.navApproved', true],
      ['claude.writing_help', true],
      ['claude.chatRetentionDays', 90],
    ]);
    expect(lines[0]?.security).toMatchObject({
      event: 'claude.setting_changed',
      workspaceId,
      userId: admin.id,
    });

    lines.length = 0;
    await change(workspaceId, { navApproved: true, switches: { writing_help: true } });
    expect(lines).toEqual([]);

    const kept = await change(workspaceId, { chatRetentionDays: null });
    expect(kept.chatRetentionDays).toBeNull();
    expect(await getWorkspaceSetting(t.db, workspaceId, 'claude.chatRetentionDays')).toBeNull();
    expect(lines).toHaveLength(1);
  });

  it('turns features on and off for askClaude through the saved switches', async () => {
    const workspaceId = setUp();
    await change(workspaceId, { switches: { meeting_summary: true } });
    expect(await isClaudeFeatureOn(t.db, workspaceId, 'meeting_summary')).toBe(false);
    await change(workspaceId, { navApproved: true });
    expect(await isClaudeFeatureOn(t.db, workspaceId, 'meeting_summary')).toBe(true);
    expect(await isClaudeFeatureOn(t.db, workspaceId, 'assistant')).toBe(false);
    await change(workspaceId, { switches: { meeting_summary: false } });
    expect(await isClaudeFeatureOn(t.db, workspaceId, 'meeting_summary')).toBe(false);
  });

  it("counts this month's requests by feature, with months starting in Denver", async () => {
    const workspaceId = setUp();
    const used = (feature: 'writing_help' | 'fields', createdAt: string) =>
      recordUsage(t.db, {
        workspaceId,
        userId: editor.id,
        feature,
        status: 'ok',
        createdAt: new Date(createdAt),
      });
    await used('writing_help', '2026-10-01T05:30:00Z'); // 11:30 pm on Sep 30 in Denver
    await used('writing_help', '2026-10-01T06:30:00Z');
    await used('fields', '2026-10-20T12:00:00Z');
    await used('fields', '2026-10-27T17:00:00Z');
    const { usage } = await claudeSettingsView(t.db, workspaceId);
    expect(usage.requests).toBe(3);
    expect(usage.byFeature).toMatchObject({ writing_help: 1, fields: 2, assistant: 0 });
  });

  it('tells each person only what they can use now', async () => {
    const workspaceId = setUp();
    await change(workspaceId, {
      navApproved: true,
      switches: { writing_help: true, fields: true },
    });
    expect((await claudeStatusFor(t.db, editor.id)).on).toEqual({
      ...ALL_OFF,
      writing_help: true,
      fields: true,
    });
    const outsider = await createUser(t.db, { name: 'Riley Outsider' });
    expect((await claudeStatusFor(t.db, outsider.id)).on).toEqual(ALL_OFF);

    while (restores.length > 0) restores.pop()?.();
    setUp({ workspaceId, canUse: false });
    expect((await claudeStatusFor(t.db, editor.id)).on).toEqual(ALL_OFF);
    while (restores.length > 0) restores.pop()?.();
    setUp({ workspaceId, apiKey: undefined });
    expect((await claudeStatusFor(t.db, editor.id)).on).toEqual(ALL_OFF);
  });

  it('answers on /api/claude only to the right people', async () => {
    const signedOut = await t.app.inject({ method: 'GET', url: '/api/claude/status' });
    expect(signedOut.statusCode).toBe(401);

    // Until the roles PR binds members, nobody is in a workspace.
    const status = await injectAs(t.app, editor, { method: 'GET', url: '/api/claude/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ on: ALL_OFF });
    const settings = await injectAs(t.app, admin, { method: 'GET', url: '/api/claude/settings' });
    expect(settings.statusCode).toBe(403);

    setUp();
    const asEditor = await injectAs(t.app, editor, {
      method: 'PUT',
      url: '/api/claude/settings',
      payload: { navApproved: true },
    });
    expect(asEditor.statusCode).toBe(403);
    const unknown = await injectAs(t.app, admin, {
      method: 'PUT',
      url: '/api/claude/settings',
      payload: { switches: { telepathy: true } },
    });
    expect(unknown.statusCode).toBe(400);
    const saved = await injectAs(t.app, admin, {
      method: 'PUT',
      url: '/api/claude/settings',
      payload: { navApproved: true, chatRetentionDays: 30 },
    });
    expect(saved.statusCode).toBe(200);
    const view = claudeSettingsViewSchema.parse(saved.json());
    expect(view).toMatchObject({ navApproved: true, chatRetentionDays: 30, keySet: true });
    const read = await injectAs(t.app, admin, { method: 'GET', url: '/api/claude/settings' });
    expect(read.json()).toEqual(saved.json());
  });

  it('has a settings table exactly as the Drizzle definition describes it', async () => {
    const config = getTableConfig(claudeSettings);
    const { rows } = await t.db.execute<{
      name: string;
      type: string;
      not_null: boolean;
      has_default: boolean;
    }>(
      sql`SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
                 attnotnull AS not_null, atthasdef AS has_default
          FROM pg_attribute
          WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`,
    );
    const inDatabase = Object.fromEntries(
      rows.map((row) => [
        row.name,
        { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
      ]),
    );
    const inDrizzle = Object.fromEntries(
      config.columns.map((column) => [
        column.name,
        { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
      ]),
    );
    expect(inDatabase).toEqual(inDrizzle);
    await expect(
      t.db.execute(
        sql`INSERT INTO claude_settings (workspace_id, key, value) VALUES (${randomUUID()}, 'theme', 'true')`,
      ),
    ).rejects.toThrow();
  });
});
