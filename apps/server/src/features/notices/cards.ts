// The cards under notices, looked up for one reader every time their chat loads.
import type { Db } from '../../db';
import { isRelativeHref } from './domain/validate';
import {
  collectCardRefs,
  eventCardKey,
  type CardLookup,
  type CardLookups,
  type EventCardInfo,
  type EventCardRef,
  type NoticeRecord,
} from './domain/view';

export type { EventCardRef } from './domain/view';

/** What the Calendar feature says about one event card, for one reader. */
export type EventCardResult =
  | {
      title: string;
      /** When it happens, worded for the reader, such as "Tue, Oct 28 · 3:00 PM". */
      when?: string;
      /** A relative path, such as `/calendar?event=<id>&occurrence=<start>`. */
      href: string;
    }
  /** The reader can't see the event. */
  | { locked: true }
  /** The event, or this occurrence of it, is gone. */
  | { deleted: true };

/**
 * Looks up event cards for a reader, keyed by `eventCardKey(card)`. Cards it leaves out are
 * locked; if it throws, every event card in that page of the chat is locked and the error logged.
 */
export type EventCardResolver = (
  db: Db,
  userId: string,
  cards: EventCardRef[],
) => Promise<ReadonlyMap<string, EventCardResult>>;

export interface NoticeCardResolvers {
  event: EventCardResolver;
}

const resolvers: Partial<NoticeCardResolvers> = {};

/**
 * Lets a feature fill in its cards: Calendar registers the 'event' resolver at start-up.
 * Registering again replaces it (tests start several apps), and null removes it.
 */
export function registerNoticeCardResolver<Type extends keyof NoticeCardResolvers>(
  type: Type,
  resolve: NoticeCardResolvers[Type] | null,
): void {
  if (resolve) resolvers[type] = resolve;
  else delete resolvers[type];
}

/**
 * What these notices' cards show this reader. Page cards stay locked until core's page cards
 * (getPageCards) are on main.
 */
export async function lookUpCards(
  db: Db,
  reader: { userId: string },
  records: readonly NoticeRecord[],
  onError: (error: unknown) => void,
): Promise<CardLookups> {
  const { events } = collectCardRefs(records);
  return { pages: new Map(), events: await lookUpEvents(db, reader.userId, events, onError) };
}

async function lookUpEvents(
  db: Db,
  userId: string,
  refs: EventCardRef[],
  onError: (error: unknown) => void,
): Promise<Map<string, CardLookup<EventCardInfo>>> {
  const lookups = new Map<string, CardLookup<EventCardInfo>>();
  const resolve = resolvers.event;
  if (!resolve || refs.length === 0) return lookups;
  let results: ReadonlyMap<string, EventCardResult>;
  try {
    results = await resolve(db, userId, refs);
  } catch (error) {
    onError(error);
    return lookups;
  }
  for (const ref of refs) {
    const key = eventCardKey(ref);
    const result = results.get(key);
    if (!result) continue;
    if ('locked' in result) lookups.set(key, 'locked');
    else if ('deleted' in result) lookups.set(key, 'deleted');
    // Never show a blank title or a link off Care Hub: the card stays locked instead.
    else if (result.title.trim() === '' || !isRelativeHref(result.href)) {
      onError(new Error(`The event card for ${key} has no title or isn't a relative link.`));
    } else {
      lookups.set(key, { title: result.title, when: result.when ?? null, href: result.href });
    }
  }
  return lookups;
}
