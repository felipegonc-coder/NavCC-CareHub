import type { MessageResponse, SendMessageBody } from '@carehub/team-chat';
import { ApiError } from '../../lib/api';

/**
 * Messages on their way. Each gets its ID in the browser, so sending it again after a dropped
 * connection never makes a duplicate, and each chat's messages go one at a time, in order.
 */
export interface PendingMessage {
  clientId: string;
  chatId: string;
  text: string;
  /** `waiting`: offline, sends when the connection is back. `failed`: Retry or Delete. */
  status: 'sending' | 'waiting' | 'failed';
  /** Why it wasn't sent. */
  error: string | null;
  /** ISO instant, where the message shows until it's sent. */
  queuedAt: string;
}

export interface OutboxDeps {
  post(chatId: string, body: Pick<SendMessageBody, 'clientId' | 'text'>): Promise<MessageResponse>;
  /** The message is on the server: show it in the chat. */
  onSent(chatId: string, answer: MessageResponse): void;
  isOnline(): boolean;
  newId(): string;
  now(): Date;
  /** Tries again after a failed connection while the browser thinks it's online. */
  retryLater(run: () => void): void;
}

export interface Outbox {
  subscribe(listener: () => void): () => void;
  /** All pending messages, oldest first; a new array after every change. */
  snapshot(): readonly PendingMessage[];
  send(chatId: string, text: string): string;
  retry(clientId: string): void;
  discard(clientId: string): void;
  /** Sends whatever waits, as when the browser comes back online. */
  resume(): void;
}

const isConnectionError = (error: unknown) => error instanceof ApiError && error.status === 0;

const reasonOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';

export function createOutbox(deps: OutboxDeps): Outbox {
  let items: readonly PendingMessage[] = [];
  const listeners = new Set<() => void>();
  const flushing = new Set<string>();

  const set = (next: readonly PendingMessage[]) => {
    items = next;
    for (const listener of listeners) listener();
  };
  const patch = (clientId: string, change: Partial<PendingMessage>) =>
    set(items.map((item) => (item.clientId === clientId ? { ...item, ...change } : item)));
  const waitAll = (chatId: string) =>
    set(
      items.map((item) =>
        item.chatId === chatId && item.status === 'sending'
          ? { ...item, status: 'waiting', error: null }
          : item,
      ),
    );

  async function flush(chatId: string): Promise<void> {
    if (flushing.has(chatId)) return;
    flushing.add(chatId);
    try {
      for (;;) {
        const next = items.find((item) => item.chatId === chatId && item.status !== 'failed');
        if (!next) return;
        if (!deps.isOnline()) {
          waitAll(chatId);
          return;
        }
        if (next.status !== 'sending') patch(next.clientId, { status: 'sending', error: null });
        try {
          const answer = await deps.post(chatId, { clientId: next.clientId, text: next.text });
          deps.onSent(chatId, answer);
          set(items.filter((item) => item.clientId !== next.clientId));
        } catch (error) {
          if (isConnectionError(error)) {
            waitAll(chatId);
            deps.retryLater(() => void flush(chatId));
            return;
          }
          patch(next.clientId, { status: 'failed', error: reasonOf(error) });
        }
      }
    } finally {
      flushing.delete(chatId);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => items,
    send(chatId, text) {
      const clientId = deps.newId();
      const status = deps.isOnline() ? 'sending' : 'waiting';
      const queuedAt = deps.now().toISOString();
      set([...items, { clientId, chatId, text, status, error: null, queuedAt }]);
      void flush(chatId);
      return clientId;
    },
    retry(clientId) {
      const item = items.find((candidate) => candidate.clientId === clientId);
      if (!item) return;
      patch(clientId, { status: deps.isOnline() ? 'sending' : 'waiting', error: null });
      void flush(item.chatId);
    },
    discard(clientId) {
      set(items.filter((item) => item.clientId !== clientId));
    },
    resume() {
      for (const chatId of new Set(items.map((item) => item.chatId))) void flush(chatId);
    },
  };
}
