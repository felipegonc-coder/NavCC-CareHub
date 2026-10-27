import { z } from 'zod';

// The meeting summary Meetings asks for (Team tools lane) and the server checks Claude's answer
// against (summarizeMeeting, docs/extras/claude.md). Everything in it is plain text: show it as text,
// never as HTML.

export const MEETING_SUMMARY_LIMITS = {
  summary: 2000,
  item: 500,
  owner: 120,
  items: 30,
} as const;

/** A string, trimmed and cut to `max`, or undefined when there's nothing usable. */
function optionalText(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined),
    z.string().optional(),
  );
}

const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, max));

/** A due date as YYYY-MM-DD; any other form is dropped rather than guessed at. */
const dueDate = z.preprocess(
  (value) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      ? value.trim()
      : undefined,
  z.string().optional(),
);

export const meetingActionItemSchema = z.object({
  text: requiredText(MEETING_SUMMARY_LIMITS.item),
  /** A name from the attendees, when the notes say who. */
  owner: optionalText(MEETING_SUMMARY_LIMITS.owner),
  due: dueDate,
});

export const meetingSummarySchema = z.object({
  summary: requiredText(MEETING_SUMMARY_LIMITS.summary),
  decisions: z
    .array(requiredText(MEETING_SUMMARY_LIMITS.item))
    .transform((items) => items.slice(0, MEETING_SUMMARY_LIMITS.items)),
  actionItems: z
    .array(meetingActionItemSchema)
    .transform((items) => items.slice(0, MEETING_SUMMARY_LIMITS.items)),
});

export type MeetingActionItem = z.infer<typeof meetingActionItemSchema>;
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;
