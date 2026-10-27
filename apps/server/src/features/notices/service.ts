import { parseSendNoticeInput, type ValidNotice } from './domain/validate';
import type { NoticeRecord } from './domain/view';
import {
  NOTICE_CREATED_EVENT,
  NOTICES_CHANGED_EVENT,
  type NoticeCreatedEvent,
  type SendNoticeInput,
  type SendNoticeResult,
} from './types';

/** Whose 🔔 Care Hub chat: one per person and workspace. */
export interface NoticeScope {
  workspaceId: string;
  userId: string;
}

/** Mark as read: these notices, or every notice up to and including this position. */
export type ReadTarget = { noticeIds: readonly string[] } | { through: number };

/** Where notices are kept: store.ts (Postgres) in the app, testing.ts (memory) in unit tests. */
export interface NoticeStore {
  /**
   * Adds the notice, or groups it into the person's latest notice with the same key when
   * `planNotice` says so: one transaction, serialized per person and key.
   */
  save(notice: ValidNotice, now: Date): Promise<SendNoticeResult>;
  /** Newest first; only positions below `before` when it's given. */
  list(
    scope: NoticeScope,
    options: { limit: number; before?: number | undefined },
  ): Promise<NoticeRecord[]>;
  countUnread(scope: NoticeScope): Promise<number>;
  /** Marks unread notices in this chat as read and returns how many changed. */
  markRead(scope: NoticeScope, target: ReadTarget, now: Date): Promise<number>;
  /** Whose chat a notice is in, or null when it doesn't exist. */
  ownerOf(noticeId: string): Promise<NoticeScope | null>;
}

/** A live nudge, as `publishToUsers` from features/live takes it. */
export interface LiveNudge {
  type: string;
  data?: Record<string, unknown>;
}

export interface NoticesRuntime {
  store: NoticeStore;
  /** `app.events.emit`, called after the commit. */
  emit: (name: string, payload: NoticeCreatedEvent) => void;
  /** `publishToUsers` from features/live, called after the commit. */
  publish: (userIds: readonly string[], event: LiveNudge) => void;
  now?: () => Date;
  /** Gets errors from the follow-ups after the commit, which never fail the send. */
  onError?: (error: unknown) => void;
}

let bound: NoticesRuntime | null = null;

/** routes.ts binds the app's runtime at start-up; the returned function unbinds it on close. */
export function bindNoticesRuntime(runtime: NoticesRuntime): () => void {
  bound = runtime;
  return () => {
    if (bound === runtime) bound = null;
  };
}

/**
 * Puts a notice in a person's 🔔 Care Hub chat. Call it after your own transaction has
 * committed. Throws a NoticeInputError when the input breaks the rules (a bug in the caller).
 */
export async function sendNotice(input: SendNoticeInput): Promise<SendNoticeResult> {
  if (!bound) throw new Error("Notices aren't running: the notices routes aren't registered.");
  return deliverNotice(bound, input);
}

export async function deliverNotice(
  runtime: NoticesRuntime,
  input: SendNoticeInput,
): Promise<SendNoticeResult> {
  const notice = parseSendNoticeInput(input);
  const result = await runtime.store.save(notice, runtime.now?.() ?? new Date());
  const { workspaceId, userId, kind } = notice;
  const event: NoticeCreatedEvent = {
    workspaceId,
    userId,
    noticeId: result.noticeId,
    kind,
    grouped: result.grouped,
  };
  afterCommit(runtime, () => runtime.emit(NOTICE_CREATED_EVENT, event));
  noticesChanged(runtime, userId);
  return result;
}

/** Tells the person's open tabs to refetch their notices and unread count. */
export function noticesChanged(runtime: NoticesRuntime, userId: string): void {
  afterCommit(runtime, () => runtime.publish([userId], { type: NOTICES_CHANGED_EVENT }));
}

function afterCommit(runtime: NoticesRuntime, run: () => void): void {
  try {
    run();
  } catch (error) {
    runtime.onError?.(error);
  }
}
