// Calendar's notices in each person's 🔔 Care Hub chat (Calendar spec, section 3; CA-06, CA-17):
// invites, time changes and cancellations go to the people on a meeting, and each reply goes to
// its organizer. Titles stay generic: the card under a notice shows the event to those who can
// see it.
import type { DeleteEventQuery, EditEvent, Reply, ReplyBody } from '@carehub/team-calendar-api';
import { occurrenceAt, type OccurrenceKey, type RepeatRule } from '@carehub/team-repeat';
import { formatDate } from '@carehub/team-time';
import type { SendNoticeInput } from '../../notices';
import type { EditPlan, EventState } from './edit';
import type { StoredEvent } from './items';
import { seriesOf, type Schedule } from './model';

/** Who a notice is from: the organizer, or the person who replied. */
export type NoticeSender = { id: string; workspaceId: string; name: string };

export const NOTICE_TITLES = {
  invited: 'Invited you to a meeting',
  changed: 'Changed the time of a meeting',
  cancelled: 'Cancelled a meeting',
  cancelledLater: 'Cancelled the rest of a repeating meeting',
} as const;

const ANSWERS: Record<Reply, string> = { going: 'Going', maybe: 'Maybe', 'not-going': 'Not going' };

type Extra = { occurrence?: OccurrenceKey | undefined; text?: string | undefined; group?: string };

function notice(
  from: NoticeSender,
  userId: string,
  title: string,
  eventId: string,
  { occurrence, text, group }: Extra = {},
): SendNoticeInput {
  return {
    workspaceId: from.workspaceId,
    userId,
    kind: 'alert',
    sender: from.name.trim().slice(0, 100) || 'Calendar',
    actorUserId: from.id,
    icon: '📅',
    title,
    ...(text ? { text } : {}),
    card: { type: 'event', eventId, ...(occurrence ? { occurrenceStart: occurrence } : {}) },
    // Several changes in a row fold into one notice (the chat groups within 5 minutes).
    ...(group ? { groupKey: `calendar:${eventId}:${group}` } : {}),
  };
}

const idsOf = (people: readonly { userId: string }[]) => people.map((person) => person.userId);

/** Invites for the people newly on an event: a new meeting, a copy, or people added. */
export const invites = (from: NoticeSender, eventId: string, userIds: readonly string[]) =>
  userIds.map((userId) => notice(from, userId, NOTICE_TITLES.invited, eventId));

/** A repeat rule's pattern (and its end, unless `withEnd` is false) in a fixed order. */
function ruleText(rule: RepeatRule | null, withEnd = true): string {
  if (!rule) return '';
  const { freq, interval, byDay, byMonthDay, byMonth, weekStart, count, until } = rule;
  const days = byDay?.map(({ day, nth }) => `${nth ?? ''}${day}`) ?? null;
  const end = withEnd ? [count ?? null, until ?? null] : [];
  return JSON.stringify([
    freq,
    interval,
    days,
    byMonthDay ?? null,
    byMonth ?? null,
    weekStart ?? null,
    ...end,
  ]);
}

/** When a whole event happens: its zone, first occurrence, rule and moved occurrences. */
function timing(schedule: Schedule): string {
  const moved = Object.entries(schedule.overrides)
    .map(([key, { start, end }]) => `${key}>${start ?? ''}|${end ?? ''}`)
    .sort();
  const { allDay, timeZone, start, end, rule } = schedule;
  return JSON.stringify([allDay, timeZone, start, end, ruleText(rule), moved]);
}

/** When one occurrence happens ('start|end'), or null when it's gone. */
function shownAt(schedule: Schedule, key: OccurrenceKey): string | null {
  const series = seriesOf(schedule);
  if (!series) return `${schedule.start}|${schedule.end}`;
  const shown = occurrenceAt(series, key);
  return shown ? `${shown.start}|${shown.end}` : null;
}

/**
 * After an edit (already checked by planEdit): invites for the people added, and a time-change
 * notice for those who stay when the times change. This and following saves the later part as
 * `splitId`, which the notices point at.
 */
export function editNotices(
  from: NoticeSender,
  before: StoredEvent,
  plan: EditPlan,
  ids: { eventId: string; splitId: string | null },
  edit: Pick<EditEvent, 'scope' | 'occurrence'>,
): SendNoticeInput[] {
  const invited = new Set(idsOf(before.people));
  const key = edit.occurrence ?? before.start;
  const notices: SendNoticeInput[] = [];
  const tell = (eventId: string, state: EventState, moved: boolean, occurrence?: OccurrenceKey) => {
    for (const userId of idsOf(state.people)) {
      if (!invited.has(userId)) notices.push(notice(from, userId, NOTICE_TITLES.invited, eventId));
      else if (moved) {
        const group = `changed:${occurrence ?? ''}`;
        notices.push(notice(from, userId, NOTICE_TITLES.changed, eventId, { occurrence, group }));
      }
    }
  };
  if (plan.split && ids.splitId) {
    const { split } = plan;
    const moved =
      shownAt(before, key) !== `${split.start}|${split.end}` ||
      split.timeZone !== before.timeZone ||
      ruleText(split.rule, false) !== ruleText(before.rule, false);
    tell(ids.eventId, plan.event, false);
    tell(ids.splitId, split, moved);
  } else if (seriesOf(before) && edit.scope === 'one') {
    tell(ids.eventId, plan.event, shownAt(before, key) !== shownAt(plan.event, key), key);
  } else {
    tell(ids.eventId, plan.event, timing(before) !== timing(plan.event));
  }
  return notices;
}

/** After a delete (`left` is what planDelete kept): the people on the meeting hear of it. */
export function cancelNotices(
  from: NoticeSender,
  before: StoredEvent,
  left: EventState | null,
  query: DeleteEventQuery,
): SendNoticeInput[] {
  const people = idsOf(before.people);
  const key = query.occurrence ?? before.start;
  if (!left) return people.map((id) => notice(from, id, NOTICE_TITLES.cancelled, before.id));
  if (query.scope === 'one') {
    const extra = { occurrence: key };
    return people.map((id) => notice(from, id, NOTICE_TITLES.cancelled, before.id, extra));
  }
  // This and following: the card shows what's left of the series.
  const text = `From ${formatDate(key.slice(0, 10), { weekday: 'short', year: false })} on.`;
  return people.map((id) => notice(from, id, NOTICE_TITLES.cancelledLater, before.id, { text }));
}

/** A reply, for the organizer. A change of mind soon after updates the same notice. */
export function replyNotice(
  from: NoticeSender,
  event: StoredEvent,
  body: ReplyBody,
): SendNoticeInput {
  const occurrence = seriesOf(event) ? body.occurrence : undefined;
  const title = `Answered ${ANSWERS[body.reply]} to your meeting`;
  const group = `reply:${from.id}:${occurrence ?? ''}`;
  return notice(from, event.organizerId, title, event.id, { occurrence, text: body.note, group });
}
