/**
 * What Messages keeps in this browser's memory for the person signed in: what they were writing in
 * each chat, and the messages still on their way (the outbox in data.ts). All of it is forgotten
 * when they sign out, and when an answer from the server shows someone else has signed in here.
 */

const drafts = new Map<string, string>();
const alsoForget = new Set<() => void>();
let viewerId: string | null = null;

/** What was being written in the chat, or ''. */
export const draftOf = (chatId: string): string => drafts.get(chatId) ?? '';

/** Keeps the composer's text while the person moves between chats; '' removes it. */
export function keepDraft(chatId: string, text: string): void {
  if (text) drafts.set(chatId, text);
  else drafts.delete(chatId);
}

/** `forget` runs each time Messages forgets the person (the outbox empties itself this way). */
export function onForget(forget: () => void): void {
  alsoForget.add(forget);
}

/** At sign-out, and when someone else signs in: drops the drafts and the unsent messages. */
export function forgetViewer(): void {
  drafts.clear();
  viewerId = null;
  for (const forget of alsoForget) forget();
}

/** Each chat answer says who is signed in; someone new means the last person's things go. */
export function noteViewer(id: string): void {
  if (viewerId !== null && viewerId !== id) forgetViewer();
  viewerId = id;
}
