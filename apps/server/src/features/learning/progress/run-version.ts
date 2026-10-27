import type { Db, Tx } from '../db';

/**
 * The course version of a learner's latest run, or null when they haven't started (decision 0311; B3 fills it
 * in). `GET /courses/:id` sends that version, else the live one. The stub returns null, so everyone gets the
 * live version.
 */
export const runVersion: (
  db: Db | Tx,
  run: { workspaceId: string; userId: string; courseId: string },
) => Promise<number | null> = async () => null;
