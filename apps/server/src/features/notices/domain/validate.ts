import { z } from 'zod';
import {
  NOTICE_KINDS,
  type NoticeActionButton,
  type NoticeButton,
  type NoticeCard,
  type NoticeKind,
} from '../types';

/** Limits for `sendNotice` input, in UTF-16 code units (what JavaScript's `length` counts). */
export const NOTICE_LIMITS = {
  sender: 100,
  title: 200,
  text: 4000,
  icon: 32,
  groupKey: 200,
  idempotencyKey: 200,
  buttons: 3,
  buttonLabel: 40,
  href: 500,
  action: 100,
  value: 200,
  choices: 5,
  eventId: 200,
} as const;

/** Thrown by `sendNotice` when its input breaks the rules: a bug in the caller, never a user error. */
export class NoticeInputError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`sendNotice: ${issues.join('; ')}`);
    this.name = 'NoticeInputError';
    this.issues = issues;
  }
}

/** `sendNotice` input after the checks. Absent and empty optional values are null. */
export interface ValidNotice {
  workspaceId: string;
  userId: string;
  kind: NoticeKind;
  sender: string;
  actorUserId: string | null;
  icon: string | null;
  title: string;
  text: string | null;
  card: NoticeCard | null;
  buttons: NoticeButton[];
  /** Always null for a mention: mentions never group. */
  groupKey: string | null;
  idempotencyKey: string | null;
}

const ORIGIN = 'https://carehub.invalid';

/**
 * A path on Care Hub itself, such as `/p/<pageId>` or `/calendar?event=1`: it starts with one
 * slash, has no spaces, control characters or backslashes, and stays on the same origin.
 */
export function isRelativeHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  for (const char of href) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || char === '\\' || /\s/u.test(char)) return false;
  }
  try {
    return new URL(href, ORIGIN).origin === ORIGIN;
  } catch {
    return false;
  }
}

const id = z.guid();
const notBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, 'Must not be empty.');
/** Optional text; blank values count as absent (see parseSendNoticeInput). */
const optionalText = (max: number) => z.string().max(max).optional();

const ACTION_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9.-]*$/;
const EVENT_ID = /^[\w.:@-]+$/;
const OCCURRENCE_START =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const buttonLabel = notBlank(NOTICE_LIMITS.buttonLabel);

const choice = z.strictObject({ label: buttonLabel, value: z.string().max(NOTICE_LIMITS.value) });

/** Links and action buttons share one shape, so each mistake gets its own clear message. */
const button = z
  .strictObject({
    label: buttonLabel,
    href: z
      .string()
      .max(NOTICE_LIMITS.href)
      .refine(isRelativeHref, 'Links must be relative paths such as /p/<pageId>.')
      .optional(),
    action: z
      .string()
      .max(NOTICE_LIMITS.action)
      .regex(ACTION_NAME, 'Use <feature>.<name>.')
      .optional(),
    value: z.string().max(NOTICE_LIMITS.value).optional(),
    choices: z.array(choice).min(1).max(NOTICE_LIMITS.choices).optional(),
  })
  .superRefine((button, ctx) => {
    const problem = (message: string, path: string[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    if (button.href !== undefined) {
      const extra = button.action ?? button.value ?? button.choices;
      if (extra !== undefined) problem('A link has only a label and an href.');
    } else if (button.action === undefined) {
      problem('A button needs an href or an action.', ['action']);
    } else if (button.choices !== undefined && button.value !== undefined) {
      problem('A button with choices takes its value from the picked choice.');
    }
  })
  .transform(({ label, href, action, value, choices }): NoticeButton => {
    if (href !== undefined || action === undefined) return { label, href: href ?? '' };
    const actionButton: NoticeActionButton = { label, action };
    if (value !== undefined) actionButton.value = value;
    if (choices !== undefined) actionButton.choices = choices;
    return actionButton;
  });

const card = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('page'), pageId: id }),
  z.strictObject({
    type: z.literal('event'),
    eventId: z.string().min(1).max(NOTICE_LIMITS.eventId).regex(EVENT_ID),
    occurrenceStart: z.string().regex(OCCURRENCE_START).optional(),
  }),
]);

export const sendNoticeInputSchema = z.strictObject({
  workspaceId: id,
  userId: id,
  kind: z.enum(NOTICE_KINDS),
  sender: notBlank(NOTICE_LIMITS.sender),
  actorUserId: id.optional(),
  icon: optionalText(NOTICE_LIMITS.icon),
  title: notBlank(NOTICE_LIMITS.title),
  text: optionalText(NOTICE_LIMITS.text),
  card: card.optional(),
  buttons: z
    .array(button)
    .max(NOTICE_LIMITS.buttons, `At most ${NOTICE_LIMITS.buttons} buttons.`)
    .optional(),
  groupKey: optionalText(NOTICE_LIMITS.groupKey),
  idempotencyKey: optionalText(NOTICE_LIMITS.idempotencyKey),
});

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value;

/** Checks `sendNotice` input; throws a NoticeInputError that lists every problem. */
export function parseSendNoticeInput(input: unknown): ValidNotice {
  const result = sendNoticeInputSchema.safeParse(input);
  if (!result.success) {
    throw new NoticeInputError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`),
    );
  }
  const notice = result.data;
  return {
    workspaceId: notice.workspaceId,
    userId: notice.userId,
    kind: notice.kind,
    sender: notice.sender,
    actorUserId: notice.actorUserId ?? null,
    icon: blankToNull(notice.icon),
    title: notice.title,
    text: blankToNull(notice.text),
    card: notice.card ?? null,
    buttons: notice.buttons ?? [],
    // Each mention is its own notice (Comments and mentions CM-08).
    groupKey: notice.kind === 'mention' ? null : blankToNull(notice.groupKey),
    idempotencyKey: blankToNull(notice.idempotencyKey),
  };
}
