import type { NoticeFilter } from './domain/filters';
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

/** Mark as read: these notices, every notice up to and including this position, or all. */
export type ReadTarget = { noticeIds: readonly string[] } | { through: number } | { all: true };

export interface ListOptions {
  limit: number;
  /** Only notices below this position: the paging cursor. */
  before?: number | undefined;
  /** Only the notices this chip shows (default all). */
  filter?: NoticeFilter | undefined;
}

/** Where notices are kept: store.ts (Postgres) in the app, testing.ts (memory) in unit tests. */
export interface NoticeStore {
  /**
   * Adds the notice, groups it into the person's latest notice with the same group key when
   * `planNotice` says so, or returns the notice already sent with the same idempotency key
   * (`duplicate: true`). One transaction, and one at a time per chat.
   */
  save(notice: ValidNotice, now: Date): Promise<SendNoticeResult>;
  /** Newest first. */
  list(scope: NoticeScope, options: ListOptions): Promise<NoticeRecord[]>;
  countUnread(scope: NoticeScope): Promise<number>;
  /** Marks unread notices in this chat as read and returns how many changed. */
  markRead(scope: NoticeScope, target: ReadTarget, now: Date): Promise<number>;
  /** The notice, or null when it doesn't exist. */
  get(noticeId: string): Promise<NoticeRecord | null>;
}

/** A live nudge, as `publishToUsers` from features/live takes it. */
export interface LiveNudge {
  type: string;
  data?: Record<string, unknown>;
}

export interface NoticesRuntime {
  store: NoticeStore;
  /** `app.events.emit`, called after the commit. */
  emit: (name: typeof NOTICE_CREATED_EVENT, payload: NoticeCreatedEvent) => void;
  /** `publishToUsers` from features/live, called after the commit. */
  publish: (userIds: readonly string[], event: LiveNudge) => void;
  /**
   * Whether the person is in the workspace, as a member or a guest. Notices for anyone else are
   * dropped. Without it every notice is kept: the app sets it once workspace members are on main.
   */
  isMember?: (workspaceId: string, userId: string) => Promise<boolean>;
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
 * Notices for someone who isn't in the workspace are dropped (`dropped: true`).
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
  const { workspaceId, userId, kind } = notice;
  if (runtime.isMember && !(await runtime.isMember(workspaceId, userId))) {
    return { noticeId: '', grouped: false, dropped: true };
  }
  const result = await runtime.store.save(notice, runtime.now?.() ?? new Date());
  // A retry: the first send already told everyone.
  if (result.duplicate) return result;
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
