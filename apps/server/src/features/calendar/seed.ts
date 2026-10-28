// Fictional Calendar data for the seeded workspace (decision 0007, section 2.5): this week's
// meetings and one event of the admin's own, so Day, Week, Month and Upcoming have something to
// show. Safe to run twice: it adds nothing once the admin has any events.
import type { RepeatRule, WeekdayCode } from '@carehub/team-repeat';
import { addDays, dayOfWeek, todayIn } from '@carehub/team-time';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db';
import type { SeedContext } from '../../seed';
import { insertEvent, type NewEvent } from './events/store';
import { calEvents } from './schema';

const ZONE = 'America/Denver';

const weekly = (...days: WeekdayCode[]): RepeatRule => ({
  freq: 'weekly',
  interval: 1,
  byDay: days.map((day) => ({ day })),
});

export async function seed(ctx: SeedContext): Promise<void> {
  const db = ctx.db as Db;
  const { workspaceId } = ctx;
  const { admin, editor, commenter, viewer } = ctx.users;
  const [seeded] = await db
    .select({ id: calEvents.id })
    .from(calEvents)
    .where(and(eq(calEvents.workspaceId, workspaceId), eq(calEvents.organizerId, admin.id)))
    .limit(1);
  if (seeded) return;

  const today = todayIn(ZONE);
  const sunday = addDays(today, -dayOfWeek(today));
  const at = (day: number, time: string) => `${addDays(sunday, day)}T${time}`;
  const invited = (...people: { id: string }[]) =>
    people.map(({ id }) => ({ userId: id, reply: null, note: null, occurrenceReplies: {} }));
  const event = (fields: Partial<NewEvent> & Pick<NewEvent, 'title' | 'start' | 'end'>) => ({
    workspaceId,
    organizerId: admin.id,
    allDay: false,
    timeZone: ZONE,
    rule: null,
    exceptions: [],
    overrides: {},
    location: '',
    description: '',
    videoUrl: null,
    people: [],
    ...fields,
  });
  const events: NewEvent[] = [
    event({
      title: 'Team huddle',
      start: at(1, '09:30'),
      end: at(1, '09:45'),
      rule: weekly('MO', 'WE', 'FR'),
      videoUrl: 'https://us02web.zoom.us/j/1000000001',
      people: invited(editor, commenter, viewer),
    }),
    event({
      title: 'QA calibration',
      start: at(2, '10:00'),
      end: at(2, '11:00'),
      location: 'Room 2',
      people: invited(editor, commenter),
    }),
    event({
      title: 'Weekly 1:1',
      start: at(3, '14:00'),
      end: at(3, '14:30'),
      rule: weekly('WE'),
      people: invited(editor),
    }),
    event({
      title: 'Coaching prep',
      start: at(4, '13:00'),
      end: at(4, '14:00'),
      description: "Questions for next week's coaching conversations.",
    }),
    event({
      title: 'Team offsite',
      allDay: true,
      start: addDays(sunday, 5),
      end: addDays(sunday, 6),
      location: 'Main office',
      people: invited(editor, commenter, viewer),
    }),
  ];
  await db.transaction(async (tx) => {
    for (const each of events) await insertEvent(tx, each);
  });
  ctx.log.info({ events: events.length }, 'Seeded Calendar');
}
