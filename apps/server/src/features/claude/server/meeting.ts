import { meetingSummarySchema, type MeetingSummary } from '@carehub/extras/claude';
import type { Db, Tx } from '../../../db';
import { askClaudeJson } from './ask';
import { ClaudeError } from './errors';
import { MAX_REQUEST_CHARS, requestChars, type ClaudeDocument } from './prompt';
import { claudeRuntime } from './runtime';

/** What Meetings sends: text its server code loaded from the meeting's notes page. */
export interface MeetingInput {
  userId: string;
  workspaceId: string;
  /** The meeting's notes page. The person must be able to open it. */
  notesPageId: string;
  agenda: string;
  notes: string;
  /** Action items already written down, one per entry. */
  actionItems: readonly string[];
  /** Attendees' names, so owners come from people who were there. */
  attendees: readonly string[];
  transcript?: string | undefined;
}

const SYSTEM = [
  'You summarize meetings for a home care team.',
  'Use only what the agenda, notes, action items and transcript say. Never invent people, dates or decisions.',
  'Write short, plain sentences.',
].join(' ');

const INSTRUCTION = [
  'Summarize this meeting as JSON with exactly these keys:',
  '"summary": two to five sentences;',
  '"decisions": the decisions made, one short sentence each (an empty list if there were none);',
  '"actionItems": every action item, the ones already written down included, each',
  '{"text": "…", "owner": "a name from the attendees, only if the notes say who", "due": "YYYY-MM-DD, only if the notes give a date"}.',
].join(' ');

const CUT_NOTE = '\n[The transcript was cut short here.]';
/** Room left for what askClaudeJson adds to the instruction. */
const MARGIN = 500;

/**
 * Asks Claude for a meeting summary (the `meeting_summary` switch). Its result goes to nobody who
 * can't open the notes: the person must be able to open the notes page, and Meetings shows the
 * summary only where the notes are.
 */
export async function summarizeMeeting(db: Db | Tx, input: MeetingInput): Promise<MeetingSummary> {
  const { pages } = claudeRuntime();
  if (!(await pages.canOpenPage(db, input.workspaceId, input.userId, input.notesPageId))) {
    throw new ClaudeError('no_permission');
  }
  const documents: ClaudeDocument[] = [
    { title: 'Agenda', text: input.agenda },
    { title: 'Notes', text: input.notes },
    { title: 'Action items already written down', text: input.actionItems.join('\n') },
    { title: 'Attendees', text: input.attendees.join('\n') },
  ].filter((document) => document.text.trim());
  const transcript = input.transcript?.trim();
  if (transcript) {
    // A long meeting's transcript is cut to fit, so the notes always go in whole.
    const room =
      MAX_REQUEST_CHARS -
      requestChars({ system: SYSTEM, instruction: INSTRUCTION, documents }) -
      'Transcript'.length -
      CUT_NOTE.length -
      MARGIN;
    if (room > 0) {
      const text = transcript.length > room ? transcript.slice(0, room) + CUT_NOTE : transcript;
      documents.push({ title: 'Transcript', text });
    }
  }
  const { data } = await askClaudeJson(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    feature: 'meeting_summary',
    system: SYSTEM,
    instruction: INSTRUCTION,
    documents,
    schema: meetingSummarySchema,
  });
  return data;
}
