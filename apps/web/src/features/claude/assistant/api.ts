// The assistant panel's requests (Claude features spec, sections 3.3 and 3.6), with the words each
// failure shows. Answers are checked against these schemas before they're drawn.
import {
  ASSISTANT_SCOPES,
  type AskRequest,
  type AskResponse,
  type AssistantChat,
  type AssistantPageLink,
  type ChatListResponse,
  type ChatResponse,
} from '@carehub/extras/claude/assistant';
import { z } from 'zod';
import { api, ApiError } from '../../../lib/api';
import { UNAVAILABLE, writeProblem, type WriteProblem } from '../write/api';

export const ASSISTANT_KEY = ['claude', 'assistant'] as const;
export const ME_KEY = [...ASSISTANT_KEY, 'me'] as const;
/** Each person's chats are kept under their own key: nobody else on this browser sees them. */
export const personKey = (userId: string) => [...ASSISTANT_KEY, 'person', userId] as const;
export const chatsKey = (userId: string) => [...personKey(userId), 'chats'] as const;
export const chatKey = (userId: string, chatId: string) =>
  [...personKey(userId), 'chat', chatId] as const;

/** Claude's 60 seconds (section 3.6), and a little more for reading the pages. */
export const ASK_TIMEOUT_MS = 75_000;
/** Pages the @ picker offers at once. */
export const PICKER_RESULTS = 8;

export const TOO_MUCH = 'That asks Claude to read too much at once. Add fewer pages, or ask less.';

const base = '/api/claude/assistant';
const chatPath = (chatId: string) => `${base}/chats/${encodeURIComponent(chatId)}`;

const pageLinkSchema = z.object({ id: z.string(), title: z.string() });
const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  questions: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['question', 'answer']),
  text: z.string(),
  scope: z.enum(ASSISTANT_SCOPES).nullable(),
  pages: z.array(pageLinkSchema),
  sources: z.array(pageLinkSchema),
  createdAt: z.string(),
});
const chatListSchema = z.object({ chats: z.array(chatSchema) });
const chatResponseSchema = z.object({ chat: chatSchema, messages: z.array(messageSchema) });
const askResponseSchema = z.object({
  chat: chatSchema,
  question: messageSchema,
  answer: messageSchema,
});
const meSchema = z.object({ user: z.object({ id: z.string() }) });
const searchSchema = z.object({
  results: z.array(z.object({ id: z.string(), title: z.string(), path: z.array(z.string()) })),
});

export function listChats(signal?: AbortSignal): Promise<ChatListResponse> {
  return api.get(`${base}/chats`, { schema: chatListSchema, signal });
}

export function loadChat(chatId: string, signal?: AbortSignal): Promise<ChatResponse> {
  return api.get(chatPath(chatId), { schema: chatResponseSchema, signal });
}

export async function renameChat(chatId: string, title: string): Promise<AssistantChat> {
  const { chat } = await api.patch(
    chatPath(chatId),
    { title },
    { schema: z.object({ chat: chatSchema }) },
  );
  return chat;
}

/** For good: the chat and its messages are gone (section 3.3). */
export async function deleteChat(chatId: string): Promise<void> {
  await api.delete(chatPath(chatId));
}

/** Who is signed in, so the layout is remembered per person. Stand-in until `useMe()` lands. */
export async function loadViewerId(signal?: AbortSignal): Promise<string> {
  const { user } = await api.get('/api/auth/me', { schema: meSchema, signal });
  return user.id;
}

/** The person pressed Stop, closed the panel, or the Assistant was switched off. */
export class AskStopped extends Error {
  override name = 'AskStopped';
}

/**
 * One question, answered and saved with its sources. Rejects with AskStopped after `signal`
 * aborts; after `timeoutMs` the request is dropped as unavailable (CL-17).
 */
export async function askAssistant(
  input: AskRequest,
  { signal, timeoutMs = ASK_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AskResponse> {
  if (signal?.aborted) throw new AskStopped('Stopped');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    return await api.post(`${base}/ask`, input, {
      schema: askResponseSchema,
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new AskStopped('Stopped');
    if (timedOut) throw new ApiError(0, 'timeout', UNAVAILABLE);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** The words for a failed question; Try again shows when it may help. */
export function askProblem(error: unknown): WriteProblem {
  const details = error instanceof ApiError ? (error.details as { reason?: unknown } | null) : null;
  if (details?.reason === 'too_long') return { message: TOO_MUCH, canRetry: false };
  return writeProblem(error, 'draft');
}

/** Pages for @, found with Care Hub Search as the person: only pages they can open. */
export async function findPages(text: string, signal?: AbortSignal): Promise<AssistantPageLink[]> {
  const { results } = await api.post(
    '/api/search/query',
    { text, limit: PICKER_RESULTS, filters: { types: ['page', 'database', 'row'] } },
    { schema: searchSchema, signal },
  );
  return results.map(({ id, title }) => ({ id, title }));
}
