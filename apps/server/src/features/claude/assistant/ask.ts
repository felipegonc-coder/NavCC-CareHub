// One question to the assistant (Claude features spec, section 3.3; CL-09, CL-10, CL-12): what the
// chip and @ let Claude read, checked again for every question, one Claude request, and the answer
// with its sources saved in the person's chat. Nothing here changes a page (CL-12).
import {
  ASSISTANT_TEXTS,
  AT_PAGES_CHARS,
  CHAT_QUESTIONS_MAX,
  SEARCH_RESULTS_SENT,
  type askRequestSchema,
  type AskResponse,
  type AssistantPageLink,
} from '@carehub/extras/claude/assistant';
import { searchWords } from '@carehub/extras/search';
import type { z } from 'zod';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { getPageText } from '../../collab';
import { runSearch } from '../../search';
import {
  askClaude,
  claudeErrorReason,
  claudeHttpError,
  isClaudeFeatureOn,
  MAX_REQUEST_CHARS,
  type ClaudeDocument,
} from '../index';
import { claudeRuntime } from '../server/runtime';
import { chatMessages, chatView, messageView, ownChat, saveTurn } from './chats';
import { openNow, pagesToRead, type Asker } from './pages';
import { bestPassages } from './passages';
import {
  ASSISTANT_SYSTEM,
  HISTORY_TURNS,
  historyDocument,
  readAnswer,
  sourceTitle,
  type EarlierTurn,
} from './prompt';

const FEATURE = 'assistant';
/** All pages I can open: the most characters sent from one result. */
const PASSAGE_CHARS = 4_000;

export type AskInput = z.output<typeof askRequestSchema>;

/** All pages I can open: Care Hub Search as the person, best match first. */
export type AssistantSearch = (
  db: Db,
  asker: Asker,
  words: readonly string[],
) => Promise<AssistantPageLink[]>;

export const careHubSearch: AssistantSearch = async (db, asker, words) => {
  const { results } = await runSearch(db, asker, {
    text: words.join(' '),
    match: 'any',
    sort: 'best',
    limit: SEARCH_RESULTS_SENT,
    // Pages, databases and rows: never files, and Search leaves out Trash and archived pages.
    filters: { types: ['page', 'database', 'row'] },
  });
  return results.map(({ id, title }) => ({ id, title }));
};
let search = careHubSearch;

/** Tests bind a fake search; the returned function unbinds it. */
export function bindAssistantSearch(next: AssistantSearch): () => void {
  search = next;
  return () => {
    if (search === next) search = careHubSearch;
  };
}

/** The chat so far. An answer goes along only while every page it could read is still open. */
async function earlierTurns(db: Db, asker: Asker, chatId: string): Promise<EarlierTurn[]> {
  const rows = await chatMessages(db, chatId);
  const last = rows.at(-1)?.turn ?? 0;
  const recent = rows.filter((row) => row.turn > last - HISTORY_TURNS);
  const open = await openNow(
    db,
    asker,
    recent.flatMap((row) => row.pages.map((page) => page.id)),
  );
  const turns: EarlierTurn[] = [];
  let answerAllowed = false;
  for (const row of recent) {
    if (row.role === 'question') {
      answerAllowed = row.pages.every((page) => open.has(page.id));
      turns.push({ question: row.text, answer: null });
    } else if (answerAllowed) {
      const turn = turns.at(-1);
      if (turn) turn.answer = row.text;
    }
  }
  return turns;
}

const size = (documents: readonly ClaudeDocument[]) =>
  documents.reduce((sum, document) => sum + document.title.length + document.text.length, 0);

/**
 * The sources for a question, numbered: the open page (This page), then @ pages, then for All
 * pages I can open the best passages of Search's top results. Every page is checked first; a chosen
 * page the person can't open now is 403.
 */
async function sourcesFor(db: Db, asker: Asker, input: AskInput, room: number) {
  const openPageId = input.scope === 'this_page' ? input.pageId : undefined;
  const chosen = await pagesToRead(db, asker, [
    ...(openPageId ? [openPageId] : []),
    ...input.pageIds,
  ]);
  if (!chosen) throw claudeHttpError('no_permission');
  // @ pages are sent in full, up to AT_PAGES_CHARS in all; the open page gets the room left.
  let atLeft = AT_PAGES_CHARS;
  const documents: ClaudeDocument[] = [];
  for (const [index, page] of chosen.entries()) {
    let text = await getPageText(db, page.id);
    if (page.id !== openPageId) {
      text = text.slice(0, atLeft);
      atLeft -= text.length;
    }
    documents.push({ title: sourceTitle(index + 1, page.title), text });
  }
  const open = openPageId ? documents[0] : undefined;
  if (open) open.text = open.text.slice(0, Math.max(0, room - size(documents) + open.text.length));
  const read = [...chosen];

  if (input.scope === 'all_pages') {
    const words = searchWords(input.question);
    const found = words.length === 0 ? [] : await search(db, asker, words);
    const canOpen = await openNow(
      db,
      asker,
      found.map((page) => page.id),
    );
    const results = found
      .filter((page) => canOpen.has(page.id) && !read.some((known) => known.id === page.id))
      .slice(0, SEARCH_RESULTS_SENT);
    let left = room - size(documents);
    for (const [index, page] of results.entries()) {
      const title = sourceTitle(read.length + 1, page.title);
      const share = Math.min(PASSAGE_CHARS, Math.floor(left / (results.length - index)));
      if (share - title.length <= 0) break;
      const text = bestPassages(await getPageText(db, page.id), words, share - title.length);
      documents.push({ title, text });
      read.push(page);
      left -= title.length + text.length;
    }
  }
  return { documents, read };
}

/**
 * Answers one question in a new or existing chat of the person's. Null when they pressed Stop
 * before the answer came: then nothing is kept.
 */
export async function answerQuestion(
  db: Db,
  asker: Asker,
  input: AskInput,
  stopped: () => boolean,
): Promise<AskResponse | null> {
  const { now } = claudeRuntime();
  const askedAt = now();
  if (!(await isClaudeFeatureOn(db, asker.workspaceId, FEATURE))) {
    throw claudeHttpError('switched_off');
  }
  const chat = input.chatId ? await ownChat(db, asker, input.chatId) : null;
  if (chat && chat.questions >= CHAT_QUESTIONS_MAX) {
    throw httpError(409, 'conflict', ASSISTANT_TEXTS.chatFull);
  }
  const instruction = `Question: ${input.question}`;
  const history = chat ? historyDocument(await earlierTurns(db, asker, chat.id)) : null;
  const room = MAX_REQUEST_CHARS - instruction.length - size(history ? [history] : []);
  const { documents, read } = await sourcesFor(db, asker, input, room);

  let answer: string = ASSISTANT_TEXTS.notFound;
  let sources: AssistantPageLink[] = [];
  // All pages I can open found nothing the person can open: that's the answer, with no request.
  if (input.scope !== 'all_pages' || read.length > 0) {
    if (stopped()) return null;
    let text: string;
    try {
      ({ text } = await askClaude(db, {
        workspaceId: asker.workspaceId,
        userId: asker.userId,
        feature: FEATURE,
        system: ASSISTANT_SYSTEM,
        instruction,
        documents: history ? [history, ...documents] : documents,
      }));
    } catch (error) {
      const reason = claudeErrorReason(error);
      if (reason) throw claudeHttpError(reason);
      throw error;
    }
    // Switched off while Claude was writing (CL-05): the answer is dropped.
    if (!(await isClaudeFeatureOn(db, asker.workspaceId, FEATURE))) {
      throw claudeHttpError('switched_off');
    }
    const reply = readAnswer(text, read.length);
    if (!reply.text) throw claudeHttpError('bad_output');
    answer = reply.text;
    if (!reply.notFound) {
      sources = reply.cited ? reply.cited.flatMap((n) => read[n - 1] ?? []) : read;
    }
  }
  if (stopped()) return null;
  const saved = await saveTurn(db, asker, {
    chatId: chat?.id ?? null,
    question: input.question,
    scope: input.scope,
    pages: read,
    answer,
    sources,
    askedAt,
    answeredAt: now(),
  });
  const open = new Set(read.map((page) => page.id));
  return {
    chat: chatView(saved.chat),
    question: messageView(saved.question, open),
    answer: messageView(saved.answer, open),
  };
}
