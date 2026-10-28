// A new meeting notes block and notes page, as ProseMirror JSON for core's page content (Meetings
// spec 2). The block's schema is the editor's Meetings lane (packages/editor/src/lanes/meetings.ts):
// `meetingNotes` holds the sections, with `meetingDetails` (Attendees and Video link) after the
// agenda and `meetingTranscript` (Your transcript) last. The web draws those two and the header.

/** A node of page content as ProseMirror JSON. */
export interface ContentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  text?: string;
}

const heading = (text: string): ContentNode => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
});

const line = (): ContentNode => ({ type: 'paragraph' });

/**
 * A new block for the notes row `notesId`, with the standard sections: Agenda, Attendees and Video
 * link, Notes, Action items (one empty to-do), Summary and Your transcript.
 */
export function notesBlock(notesId: string): ContentNode {
  return {
    type: 'meetingNotes',
    attrs: { notesId },
    content: [
      heading('Agenda'),
      line(),
      { type: 'meetingDetails' },
      heading('Notes'),
      line(),
      heading('Action items'),
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [line()] }],
      },
      heading('Summary'),
      line(),
      { type: 'meetingTranscript' },
    ],
  };
}

/** A new notes page (Take meeting notes, MT-01): its block, and a line under it. */
export function notesPage(notesId: string): ContentNode {
  return { type: 'doc', content: [notesBlock(notesId), line()] };
}
