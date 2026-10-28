import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, type DatabaseConnection, type Db } from '../../../db';
import { createTestDatabase, createUser, hasDatabase } from '../../../testing';
import { claudeUsage } from '../schema';
import { ClaudeError } from './errors';
import { summarizeMeeting, type MeetingInput } from './meeting';
import { MAX_REQUEST_CHARS } from './prompt';
import { configureClaude } from './runtime';
import { CLAUDE_MESSAGES_URL } from './settings';

// Fictional people, meetings and key only.
const KEY = 'sk-ant-FICTIONAL-test-key-0003';

const SUMMARY = {
  summary: 'The huddle moves to Tuesdays.',
  decisions: ['Huddle on Tuesdays.'],
  actionItems: [{ text: 'Update the invite.', owner: 'Sam Rivera', due: 'soon' }],
};

const answer = (text: string) =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 40, output_tokens: 12 },
    }),
    { status: 200 },
  );

describe.skipIf(!hasDatabase)('summarizeMeeting', () => {
  let connection: DatabaseConnection;
  let db: Db;
  let drop: () => Promise<void>;
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    connection = createDatabase(database.url);
    db = connection.db;
    await runMigrations(connection.pool);
  });

  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
  });

  afterAll(async () => {
    await connection?.close();
    await drop?.();
  });

  /** Everything on; the person can open only `openPageId`; Claude gives the replies in order. */
  function setUp(replies: string[], openPageId: string) {
    const workspaceId = randomUUID();
    const bodies: Array<{ system: string; messages: Array<{ content: string }> }> = [];
    restores.push(
      configureClaude({
        settings: () => ({
          apiKey: KEY,
          model: 'claude-test',
          monthlyRequests: 3000,
          url: CLAUDE_MESSAGES_URL,
        }),
        db,
        access: {
          settingsOn: async (_db, _id, keys) => new Set(keys),
          canUseClaude: async () => true,
        },
        pages: {
          canOpenPage: async (_db, id, _userId, pageId) =>
            id === workspaceId && pageId === openPageId,
        },
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as (typeof bodies)[number]);
          return answer(replies.shift() ?? JSON.stringify(SUMMARY));
        },
        sleep: async () => {},
        log: { warn: () => {} },
      }),
    );
    return {
      workspaceId,
      bodies,
      sent: () => bodies.map((body) => body.messages[0]?.content ?? ''),
    };
  }

  async function meeting(overrides: Partial<MeetingInput> = {}) {
    const sam = await createUser(db);
    const notesPageId = randomUUID();
    return {
      userId: sam.id,
      workspaceId: randomUUID(),
      notesPageId,
      agenda: 'Rota for November.',
      notes: 'Sam will update the huddle invite. We agreed Tuesdays.',
      actionItems: ['Update the invite'],
      attendees: ['Sam Rivera', 'Alex Chen'],
      ...overrides,
    } satisfies MeetingInput;
  }

  it('sends the notes as data and gives back a checked summary', async () => {
    const input = await meeting();
    const { workspaceId, bodies, sent } = setUp([], input.notesPageId);
    const summary = await summarizeMeeting(db, { ...input, workspaceId, transcript: 'Hello all.' });

    expect(summary).toEqual({
      summary: SUMMARY.summary,
      decisions: SUMMARY.decisions,
      actionItems: [{ text: 'Update the invite.', owner: 'Sam Rivera' }],
    });
    const [user] = sent();
    for (const title of [
      'Agenda',
      'Notes',
      'Action items already written down',
      'Attendees',
      'Transcript',
    ]) {
      expect(user).toContain(`title="${title}"`);
    }
    expect(user).toContain('Sam will update the huddle invite.');
    expect(bodies[0]?.system).toContain('You summarize meetings');
    const rows = await db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.workspaceId, workspaceId));
    expect(rows).toMatchObject([{ feature: 'meeting_summary', status: 'ok' }]);
  });

  it('sends nothing when the person cannot open the notes', async () => {
    const input = await meeting();
    const { workspaceId, sent } = setUp([], randomUUID());
    const refused = await summarizeMeeting(db, { ...input, workspaceId }).catch((error) => error);
    expect(refused).toBeInstanceOf(ClaudeError);
    expect((refused as ClaudeError).reason).toBe('no_permission');
    expect(sent()).toEqual([]);
  });

  it('cuts a long transcript so the notes always go in whole', async () => {
    const input = await meeting();
    const { workspaceId, sent } = setUp([], input.notesPageId);
    await summarizeMeeting(db, { ...input, workspaceId, transcript: 'word '.repeat(20_000) });
    const [user = ''] = sent();
    expect(user).toContain('Sam will update the huddle invite.');
    expect(user).toContain('[The transcript was cut short here.]');
    expect(user.length).toBeLessThan(MAX_REQUEST_CHARS + 2_000);
  });

  it('refuses an answer that is not a summary', async () => {
    const input = await meeting();
    const { workspaceId } = setUp(['{"summary": ""}'], input.notesPageId);
    const failed = await summarizeMeeting(db, { ...input, workspaceId }).catch((error) => error);
    expect((failed as ClaudeError).reason).toBe('bad_output');
  });
});
