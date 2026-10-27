// Fictional notices for every seeded person, so the 🔔 Care Hub chat isn't empty in development.
// Safe to run twice: each notice has an idempotency key.
import type { Db } from '../../db';
import type { SeedContext } from '../../seed';
import { parseSendNoticeInput } from './domain/validate';
import { createNoticeStore } from './store';
import type { SendNoticeInput } from './types';

type SeedNotice = Omit<SendNoticeInput, 'workspaceId' | 'userId'> & {
  idempotencyKey: string;
  /** How long ago it arrived. */
  ago: number;
  read: boolean;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Oldest first, so the newest gets the highest position. */
const SEED_NOTICES: readonly SeedNotice[] = [
  {
    idempotencyKey: 'seed:welcome',
    kind: 'alert',
    sender: 'Care Hub',
    icon: '👋',
    title: 'Welcome to your Care Hub chat',
    text: 'Care Hub sends reminders, automations and alerts here.',
    ago: 2 * DAY,
    read: true,
  },
  {
    idempotencyKey: 'seed:automation',
    kind: 'automation',
    sender: 'Weekly check-in',
    title: 'Your automation ran',
    text: "This week's notes page is ready.",
    ago: DAY,
    read: true,
  },
  {
    idempotencyKey: 'seed:mention',
    kind: 'mention',
    sender: 'Sam Ortiz',
    title: 'Mentioned you in a comment',
    text: 'Can you look at the scoring before Friday?',
    ago: 2 * HOUR,
    read: false,
  },
  {
    idempotencyKey: 'seed:reminder',
    kind: 'reminder',
    sender: 'Reminders',
    title: 'Reminder',
    text: 'Call Jordan Patel about the new schedule.',
    buttons: [{ label: 'Open reminders', href: '/reminders' }],
    ago: 10 * MINUTE,
    read: false,
  },
];

export async function seed(ctx: SeedContext): Promise<void> {
  // The SeedContext stand-in types `db` loosely until core's database type is in seed.ts.
  const store = createNoticeStore(ctx.db as Db);
  const started = Date.now();
  for (const user of Object.values(ctx.users)) {
    const chat = { workspaceId: ctx.workspaceId, userId: user.id };
    for (const { ago, read, ...notice } of SEED_NOTICES) {
      const at = new Date(started - ago);
      const result = await store.save(parseSendNoticeInput({ ...chat, ...notice }), at);
      if (read && !result.duplicate) {
        await store.markRead(chat, { noticeIds: [result.noticeId] }, at);
      }
    }
  }
  ctx.log.info('Seeded notices');
}
