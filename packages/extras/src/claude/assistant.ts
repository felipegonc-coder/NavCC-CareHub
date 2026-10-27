// @carehub/extras/claude/assistant: the assistant panel's limits, words and requests, shared by the
// web app and the server (Claude features spec, section 3.3; checks CL-09 to CL-12). Rules for
// everything sent to Claude: docs/extras/claude.md.
import { z } from 'zod';

/** What Claude may read for a question: the question box's chip. */
export const ASSISTANT_SCOPES = ['this_page', 'all_pages', 'no_pages'] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];

export const ASSISTANT_SCOPE_LABELS: Readonly<Record<AssistantScope, string>> = {
  this_page: 'This page',
  all_pages: 'All pages I can open',
  no_pages: 'No pages',
};

/** Questions one chat remembers. Then it asks for a new chat. */
export const CHAT_QUESTIONS_MAX = 50;
/** Pages @ can add to a question. */
export const AT_PAGES_MAX = 5;
/** Characters of @ pages sent with a question, in all. */
export const AT_PAGES_CHARS = 40_000;
/** All pages I can open: how many of Search's best matches send their passages. */
export const SEARCH_RESULTS_SENT = 10;
export const QUESTION_MAX = 4_000;
export const CHAT_TITLE_MAX = 80;

export const ASSISTANT_TEXTS = {
  empty: 'Ask about this page, or anything in the pages you can open.',
  notFound: "I couldn't find that in the pages you can open.",
  chatFull:
    'This chat has 50 questions, as many as a chat remembers. Start a new chat to ask more.',
} as const;

const idSchema = z.uuid({ error: "That ID isn't right." });

/** POST /api/claude/assistant/ask */
export const askRequestSchema = z
  .object({
    /** Left out for a new chat: the first answer creates it, titled from the question. */
    chatId: idSchema.optional(),
    question: z
      .string()
      .trim()
      .min(1, { error: 'Type a question.' })
      .max(QUESTION_MAX, { error: 'Ask in up to 4,000 characters.' }),
    scope: z.enum(ASSISTANT_SCOPES),
    /** The page open in the main area. This page needs it. */
    pageId: idSchema.optional(),
    /** Pages added with @, sent in full. */
    pageIds: z.array(idSchema).max(AT_PAGES_MAX, { error: 'Add up to 5 pages.' }).default([]),
  })
  .strict()
  .refine((input) => input.scope !== 'this_page' || input.pageId !== undefined, {
    error: 'Open a page to ask about it.',
    path: ['pageId'],
  });
export type AskRequest = z.input<typeof askRequestSchema>;

/** PATCH /api/claude/assistant/chats/:chatId */
export const renameChatSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { error: 'Give the chat a name.' })
      .max(CHAT_TITLE_MAX, { error: 'Use up to 80 characters.' }),
  })
  .strict();

export const chatIdParamsSchema = z.object({ chatId: idSchema });

/** A page as a link that opens in the main area. */
export interface AssistantPageLink {
  id: string;
  title: string;
}

export interface AssistantChat {
  id: string;
  title: string;
  /** Questions asked so far, up to CHAT_QUESTIONS_MAX. */
  questions: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessage {
  id: string;
  role: 'question' | 'answer';
  /** The question, or the answer in Markdown. */
  text: string;
  /** Questions: the chip when it was asked. */
  scope: AssistantScope | null;
  /** Questions: what Claude could read, as far as the person can still open it. */
  pages: AssistantPageLink[];
  /** Answers: the pages the answer came from, as far as the person can still open them. */
  sources: AssistantPageLink[];
  createdAt: string;
}

/** GET /api/claude/assistant/chats: the person's own chats, last used first. */
export interface ChatListResponse {
  chats: AssistantChat[];
}

/** GET /api/claude/assistant/chats/:chatId */
export interface ChatResponse {
  chat: AssistantChat;
  messages: AssistantMessage[];
}

/** POST /api/claude/assistant/ask */
export interface AskResponse {
  chat: AssistantChat;
  question: AssistantMessage;
  answer: AssistantMessage;
}

/** A new chat's title: the first line of its first question, cut at a word. */
export function chatTitleFrom(question: string): string {
  const line =
    question
      .split('\n')
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .find(Boolean) ?? '';
  if (!line) return 'New chat';
  if (line.length <= CHAT_TITLE_MAX) return line;
  const cut = line.slice(0, CHAT_TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > CHAT_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
