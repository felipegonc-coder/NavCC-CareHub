import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core';

// Owned by the Meetings lane: its page blocks, schema only (rules in ./index.ts).

/** What the attribute parser reads. Typed by that, so the schema needs no DOM types. */
type Readable = { getAttribute(name: string): string | null };

/**
 * A meeting notes block, made by Take meeting notes or "/meeting notes" (Meetings spec 2).
 * `notesId` is its meetings_notes row, which links it to one event occurrence, or to none for a
 * standalone block. The header (title, date and time, Join, Open in Calendar) is drawn from that
 * row and its event, so nothing of the event is stored in the page.
 *
 * Its sections are its content, in order: ordinary blocks (Agenda), then `meetingDetails`
 * (Attendees and Video link), more ordinary blocks (Notes, Action items, Summary) and
 * `meetingTranscript` (Your transcript) last. There is always exactly one of each part: an edit
 * that removes one gets a new one in its place. A new block, as Take meeting notes makes it:
 *
 *     meetingNotes { notesId }
 *       heading (level 2) "Agenda", paragraph
 *       meetingDetails
 *       heading "Notes", paragraph
 *       heading "Action items", taskList > taskItem { checked: false } > paragraph
 *       heading "Summary", paragraph
 *       meetingTranscript
 */
const meetingNotes = Node.create({
  name: 'meetingNotes',
  group: 'block',
  content: 'block* meetingDetails block+ meetingTranscript',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      notesId: {
        default: null,
        parseHTML: (element: Readable) => element.getAttribute('data-notes-id'),
        renderHTML: (attributes: { notesId?: unknown }) =>
          typeof attributes.notesId === 'string' ? { 'data-notes-id': attributes.notesId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="meetingNotes"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'meetingNotes' }, HTMLAttributes), 0];
  },
});

/**
 * A part of a meeting notes block, drawn by the web from Care Hub's data. It stores nothing and
 * exists only inside a block: pasted on its own, it's left out.
 */
function part(name: 'meetingDetails' | 'meetingTranscript') {
  return Node.create({
    name,
    atom: true,
    selectable: false,
    draggable: false,

    parseHTML() {
      return [{ tag: `div[data-type="${name}"]`, context: 'meetingNotes/' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes({ 'data-type': name }, HTMLAttributes)];
    },
  });
}

export const nodes: AnyExtension[] = [
  meetingNotes,
  part('meetingDetails'),
  part('meetingTranscript'),
];
