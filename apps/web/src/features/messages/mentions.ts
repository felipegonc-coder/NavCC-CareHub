import { mentionToken, messagePlainText, personName, type NameOf } from '@carehub/team-chat';

/** The text as people read it, for Copy text and editing: mentions read "@Avery Lin". */
export function readableText(text: string, mentions: readonly string[], nameOf: NameOf): string {
  return messagePlainText(text, nameOf, { mentionable: mentions });
}

/** Back to stored text after an edit: "@Avery Lin" is Avery's mention again, if it was before. */
export function storedText(text: string, mentions: readonly string[], nameOf: NameOf): string {
  const labels = mentions
    .map((userId) => ({ userId, label: `@${personName(nameOf(userId))}` }))
    .sort((a, b) => b.label.length - a.label.length);
  let result = text;
  for (const { userId, label } of labels) result = result.split(label).join(mentionToken(userId));
  return result;
}

/** What's typed after an "@" just before the caret: who to suggest, and where the "@" is. */
export interface MentionQuery {
  /** Where the "@" is. */
  start: number;
  query: string;
}

/** Long enough for a first and last name; past that, the "@" was something else. */
const QUERY_MAX = 40;

/** The mention being typed: an "@" at the start or after a space, then no line break. */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0) return null;
  if (start > 0 && !/\s/u.test(before.charAt(start - 1))) return null;
  const query = before.slice(start + 1);
  if (query.length > QUERY_MAX || /[\n@]/u.test(query) || /^\s/u.test(query)) return null;
  return { start, query };
}

/** Puts "@Avery Lin " in place of what was typed; the caret goes after the space. */
export function insertMention(
  text: string,
  at: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const label = `@${name} `;
  const rest = text.slice(caret).replace(/^ /u, '');
  return { text: text.slice(0, at.start) + label + rest, caret: at.start + label.length };
}

/** Ignores case and accents: "jose" finds "José". */
export const foldText = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** People whose name has a word starting with each word typed: "av l" finds Avery Lin. */
export function suggestPeople<T extends { name: string }>(
  people: readonly T[],
  query: string,
): T[] {
  const typed = foldText(query).split(/\s+/u).filter(Boolean);
  return people.filter((person) => {
    const words = foldText(person.name).split(/\s+/u);
    return typed.every((part) => words.some((word) => word.startsWith(part)));
  });
}
