import type { CreateCommentInput, CreateCommentResponse } from '@carehub/shared';
import { errorMessage } from './api';

/** A comment on its way to the server, or one that couldn't be sent (its text is kept). */
export interface OutgoingComment {
  /** Local only. */
  id: string;
  input: CreateCommentInput;
  status: 'sending' | 'failed';
  /** Why it failed. */
  error?: string;
}

/**
 * The comments being sent on one page. The threads show them faded while they go, and with
 * "Not sent · Retry · Delete" if they fail, so the text is never lost. `deliver` sends one and
 * resolves once the threads have it.
 */
export class Outbox {
  private items: readonly OutgoingComment[] = [];
  private readonly listeners = new Set<() => void>();
  private count = 0;

  constructor(
    private readonly deliver: (input: CreateCommentInput) => Promise<CreateCommentResponse>,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly OutgoingComment[] => this.items;

  /** Sends a comment. Resolves to its IDs, or null if it failed (it stays here as failed). */
  send(input: CreateCommentInput): Promise<CreateCommentResponse | null> {
    this.count += 1;
    const id = `outgoing-${this.count}`;
    this.set([...this.items, { id, input, status: 'sending' }]);
    return this.attempt(id);
  }

  retry(id: string): Promise<CreateCommentResponse | null> {
    this.change(id, { status: 'sending', error: undefined });
    return this.attempt(id);
  }

  /** Drops a failed comment ("Delete"). */
  discard(id: string): void {
    this.set(this.items.filter((item) => item.id !== id));
  }

  private async attempt(id: string): Promise<CreateCommentResponse | null> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return null;
    try {
      const sent = await this.deliver(item.input);
      this.discard(id);
      return sent;
    } catch (error) {
      this.change(id, { status: 'failed', error: errorMessage(error) });
      return null;
    }
  }

  private change(id: string, patch: Partial<OutgoingComment>): void {
    this.set(this.items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  private set(items: readonly OutgoingComment[]): void {
    this.items = items;
    for (const listener of this.listeners) listener();
  }
}
