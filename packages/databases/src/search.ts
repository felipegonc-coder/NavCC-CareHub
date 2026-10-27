/**
 * Toolbar search (Databases spec 3.2; additions 10): the text a row can be found by, and matching
 * every word of a query against it. It ignores case and accents and is never saved.
 */
import { plainText } from './richtext';
import { readValue } from './row';
import { foldText } from './text';
import type { Id, EvalContext, RichText, Row, SelectOption } from './types';

/** What Created by and Edited by show for an anonymous form response (additions 8). */
const ANONYMOUS = 'Anonymous';

const idList = (v: unknown): Id[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? (v as Id[]) : [];

/**
 * Everything search looks at, folded (lower case, no accents), one value per line: the title;
 * Text, Link, Email and Phone values; option names; people's names (Person, Created by and
 * Edited by); and the ID with its prefix ("qa-12", which "12" also finds). Only properties in
 * ctx.properties count, so leave out the ones the viewer can't see. The server can keep this
 * per row and check queries with textHasWords.
 */
export function rowSearchText(row: Row, ctx: EvalContext): string {
  const parts: string[] = [];
  const add = (text: string | null | undefined): void => {
    if (text) parts.push(text);
  };
  add(row.title);
  for (const prop of ctx.properties) {
    const config = prop.config;
    switch (config.type) {
      case 'text':
        add(plainText(readValue(row, prop) as RichText | null));
        break;
      case 'url':
      case 'email':
      case 'phone':
        add(readValue(row, prop) as string | null);
        break;
      case 'select':
      case 'status':
      case 'multi_select': {
        const options: readonly SelectOption[] = config.options;
        for (const id of idList(readValue(row, prop))) add(options.find((o) => o.id === id)?.name);
        break;
      }
      case 'person':
      case 'created_by':
      case 'edited_by': {
        const people = idList(readValue(row, prop));
        if (!people.length && config.type !== 'person') add(ANONYMOUS);
        for (const id of people) add(ctx.userName(id));
        break;
      }
      case 'unique_id':
        if (row.uniqueNumber !== null) {
          add(config.prefix ? `${config.prefix}-${row.uniqueNumber}` : String(row.uniqueNumber));
        }
        break;
      default:
        break;
    }
  }
  return foldText(parts.join('\n'));
}

/** The words of a search query, folded; [] for a blank query. */
export function searchWords(query: string): string[] {
  return foldText(query)
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** True if every word appears somewhere in text made by rowSearchText (no words: true). */
export function textHasWords(searchText: string, words: readonly string[]): boolean {
  return words.every((word) => searchText.includes(word));
}

/**
 * True if every word of the query appears in the row's title, values, option names, people's
 * names or ID, ignoring case and accents ("cafe" finds "Café"). A blank query matches every row.
 */
export function matchesSearch(row: Row, query: string, ctx: EvalContext): boolean {
  const words = searchWords(query);
  return words.length === 0 || textHasWords(rowSearchText(row, ctx), words);
}
