/**
 * Send a message (Automations spec, section 3: Message): a 🔔 notice for each recipient, from
 * "Automation:" and the automation's name, with the fill-ins filled in for them and only the page
 * cards they can open (AU-10). Recipients are worked out when it runs, so removed members are
 * skipped; Send only to me messages the tester alone, marked Test (AU-04).
 */
import { LIMITS, type Action, type Recipient } from '@carehub/team-automations/automation';
import {
  fillIn,
  fillInDate,
  firstNameOf,
  messageTimeZone,
} from '@carehub/team-automations/message';
import {
  NOTICE_LIMITS,
  type NoticeButton,
  type NoticeCard,
  type SendNoticeInput,
} from '../notices';
import { senderFor, type StepContext, type StepDone } from './running';

type SendMessageAction = Extract<Action, { kind: 'sendMessage' }>;

/** A member of the workspace, as recipients are worked out. */
export interface Person {
  userId: string;
  name: string;
  roleId: string | null;
  /** Admins hear about automations that switched off. */
  isAdmin: boolean;
}

export interface SendMessageOptions {
  /** The workspace's members now. Guests are left out: they have no Messages. */
  people: (workspaceId: string) => Promise<readonly Person[]>;
  /** Of these pages, the ones this person can open (at least 'view'). */
  pagesOpenTo: (userId: string, pageIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** `sendNotice` from features/notices. */
  sendNotice: (input: SendNoticeInput) => Promise<unknown>;
}

const TEST_MARK = 'Test: ';

/** Who it goes to now: everyone, or the picked people still here and the roles' members. */
export function recipientsAmong(
  recipients: readonly Recipient[],
  people: readonly Person[],
): Person[] {
  if (recipients.some((recipient) => recipient.kind === 'everyone')) return [...people];
  const userIds = new Set(recipients.flatMap((r) => (r.kind === 'person' ? [r.userId] : [])));
  const roleIds = new Set(recipients.flatMap((r) => (r.kind === 'role' ? [r.roleId] : [])));
  return people.filter(
    (person) =>
      userIds.has(person.userId) || (person.roleId !== null && roleIds.has(person.roleId)),
  );
}

/** The notice's title is the message's first line and its text the rest; a long line is cut. */
export function noticeWords(
  message: string,
  cards: number,
  test: boolean,
): { title: string; text?: string } {
  const mark = test ? TEST_MARK : '';
  const trimmed = message.trim();
  const end = trimmed.indexOf('\n');
  const first = (end === -1 ? trimmed : trimmed.slice(0, end)).trim();
  const rest = end === -1 ? '' : trimmed.slice(end + 1).trim();
  const line = first || (cards > 1 ? 'Shared some pages with you' : 'Shared a page with you');
  const room = NOTICE_LIMITS.title - mark.length;
  if (line.length > room) return { title: `${mark}${line.slice(0, room - 1)}…`, text: trimmed };
  return rest ? { title: mark + line, text: rest } : { title: mark + line };
}

/** A notice has one card: the first page they can open. The others open from its buttons. */
function pageCards(pageIds: readonly string[]): { card?: NoticeCard; buttons?: NoticeButton[] } {
  const [first, ...rest] = pageIds;
  if (!first) return {};
  const card: NoticeCard = { type: 'page', pageId: first };
  if (rest.length === 0) return { card };
  const buttons = rest.map((pageId, i) => ({ label: `Open page ${i + 2}`, href: `/p/${pageId}` }));
  return { card, buttons };
}

function sentMessage(sent: number, over: number, test: boolean): string {
  if (test) return sent > 0 ? 'Sent only to you (Test)' : 'No one to message';
  if (sent === 0) return 'No one to message';
  const messaged = `Messaged ${sent} ${sent === 1 ? 'person' : 'people'}`;
  return over > 0 ? `${messaged}, the most at once; ${over} more weren't messaged` : messaged;
}

/** The `sendMessage` performer for the automation runner. */
export function createSendMessage(options: SendMessageOptions) {
  async function openPages(userId: string, pageIds: readonly string[]): Promise<string[]> {
    if (pageIds.length === 0) return [];
    const open = await options.pagesOpenTo(userId, pageIds);
    return pageIds.filter((pageId) => open.has(pageId));
  }

  return async function sendMessage(
    action: SendMessageAction,
    ctx: StepContext,
  ): Promise<StepDone> {
    const { automation, run, step, onlyTo, signal } = ctx;
    const people = await options.people(automation.workspaceId);
    const everyone =
      onlyTo === null
        ? recipientsAmong(action.recipients, people)
        : people.filter((person) => person.userId === onlyTo);
    const to = everyone.slice(0, LIMITS.recipients);
    const day = run.plannedFor ?? run.ranAt ?? run.createdAt;
    const date = fillInDate(day, messageTimeZone(automation.trigger));
    let sent = 0;
    for (const person of to) {
      signal.throwIfAborted();
      const pageIds = await openPages(person.userId, action.pageIds);
      const text = fillIn(action.text, { firstName: firstNameOf(person.name), date });
      // Nothing they may see: no words, and no page they can open.
      if (text.trim() === '' && pageIds.length === 0) continue;
      await options.sendNotice({
        workspaceId: automation.workspaceId,
        userId: person.userId,
        kind: 'automation',
        sender: senderFor(automation.name),
        ...noticeWords(text, pageIds.length, onlyTo !== null),
        ...pageCards(pageIds),
        // A retried step updates the notices it already sent instead of sending them twice.
        groupKey: `automations:${run.id}:${step}`,
      });
      sent += 1;
    }
    const over = everyone.length - to.length;
    return { message: sentMessage(sent, over, onlyTo !== null), recipients: sent };
  };
}
