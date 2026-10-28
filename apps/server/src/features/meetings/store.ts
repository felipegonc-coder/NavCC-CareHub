// Meeting notes in Postgres: migrations/202610271940_meetings_notes.sql.
import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import type { NotesStore } from './service';
import type { MeetingNotes } from './types';

const NOTES = sql.raw(`id, workspace_id AS "workspaceId", page_id AS "pageId",
  event_id AS "eventId", occurrence_key AS "occurrenceKey", created_by AS "createdBy",
  created_at AS "createdAt"`);

async function rows<Row>(db: Db | Tx, statement: SQL): Promise<Row[]> {
  const result = await db.execute(statement);
  return result.rows as unknown as Row[];
}

async function notesRow(db: Db | Tx, statement: SQL): Promise<MeetingNotes | null> {
  const [row] = await rows<Omit<MeetingNotes, 'createdAt'> & { createdAt: Date | string }>(
    db,
    statement,
  );
  // Timestamps may come back as text (Drizzle's node-postgres driver) or as Dates.
  return row ? { ...row, createdAt: new Date(row.createdAt) } : null;
}

export const postgresNotesStore: NotesStore = {
  async lock(tx, key) {
    await rows(tx, sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  },

  findForOccurrence: (db, { workspaceId, eventId, occurrenceKey }) =>
    notesRow(
      db,
      sql`SELECT ${NOTES} FROM meetings_notes
        WHERE workspace_id = ${workspaceId}::uuid AND event_id = ${eventId}
          AND occurrence_key = ${occurrenceKey}`,
    ),

  async insert(tx, { workspaceId, pageId, eventId, occurrenceKey, createdBy }) {
    const notes = await notesRow(
      tx,
      sql`INSERT INTO meetings_notes (workspace_id, page_id, event_id, occurrence_key, created_by)
        VALUES (${workspaceId}::uuid, ${pageId}::uuid, ${eventId}, ${occurrenceKey},
          ${createdBy}::uuid)
        RETURNING ${NOTES}`,
    );
    if (!notes) throw new Error('The meeting notes were not saved.');
    return notes;
  },

  async grantedUsers(db, notesId) {
    const granted = await rows<{ user_id: string }>(
      db,
      sql`SELECT user_id FROM meetings_grants WHERE notes_id = ${notesId}::uuid`,
    );
    return granted.map((row) => row.user_id);
  },

  async addGrant(tx, { notesId, userId, grantId }) {
    await rows(
      tx,
      sql`INSERT INTO meetings_grants (notes_id, user_id, grant_id)
        VALUES (${notesId}::uuid, ${userId}::uuid, ${grantId}::uuid)`,
    );
  },

  async getPlace(db, workspaceId, userId) {
    const [place] = await rows<{ parent_page_id: string }>(
      db,
      sql`SELECT parent_page_id FROM meetings_places
        WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid`,
    );
    return place?.parent_page_id ?? null;
  },

  async setPlace(tx, { workspaceId, userId, pageId }) {
    await rows(
      tx,
      sql`INSERT INTO meetings_places (workspace_id, user_id, parent_page_id)
        VALUES (${workspaceId}::uuid, ${userId}::uuid, ${pageId}::uuid)
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET parent_page_id = EXCLUDED.parent_page_id`,
    );
  },
};
