import { z } from 'zod';
import { REACTIONS_MAX_DISTINCT } from './constants';
import { listNames, namesOf } from './names';
import type { MessageKind, NameOf } from './types';

// Reactions: any single Unicode emoji. They notify nobody and don't change unread counts, so
// nothing here touches notify or unread.

const EMOJI_MAX_LENGTH = 64;
const EMOJI_PARTS = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP = /^[0-9#*]\uFE0F\u20E3$/u;
const STRAY_SKIN_TONE = /(?<!\p{Emoji_Modifier_Base})\p{Emoji_Modifier}/u;
const SELECTORS = /[\uFE0E\uFE0F]/gu;
const TEXT_STYLE = /^(?=\p{Emoji})\P{Emoji_Presentation}$/u;
const SKIN_TONE = /^\p{Emoji_Modifier}$/u;

let graphemes: Intl.Segmenter | undefined;
function graphemeCount(text: string): number {
  graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...graphemes.segment(text)].length;
}

/** The same emoji always gets the same text: "❤" and "❤️" are one reaction. */
function canonicalEmoji(text: string): string {
  const points = [...text.replace(SELECTORS, '')];
  return points
    .map((point, i) => {
      const next = points[i + 1];
      const wantsSelector = TEXT_STYLE.test(point) && !(next && SKIN_TONE.test(next));
      return wantsSelector ? `${point}\uFE0F` : point;
    })
    .join('');
}

/** A reaction's stored text, or null if it isn't exactly one emoji. */
export function normalizeReactionEmoji(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > EMOJI_MAX_LENGTH) return null;
  const emoji = canonicalEmoji(text);
  if (!EMOJI_PARTS.test(emoji) || STRAY_SKIN_TONE.test(emoji) || graphemeCount(emoji) !== 1) {
    return null;
  }
  return PICTOGRAPH.test(emoji) || FLAG.test(emoji) || KEYCAP.test(emoji) ? emoji : null;
}

export const reactionBodySchema = z.object({ emoji: z.string().min(1).max(EMOJI_MAX_LENGTH) });

export interface Reaction {
  userId: string;
  /** Stored by `normalizeReactionEmoji`. */
  emoji: string;
  reactedAt: Date;
}

export type ReactionError = 'cannot-react' | 'not-an-emoji' | 'already-reacted' | 'too-many-emoji';

/**
 * MS-18: one of each emoji per person and 20 different emoji per message, only on people's
 * messages. `canReact` comes from `chatPermissions`, so notices and other people's chats are out.
 */
export function checkAddReaction(input: {
  canReact: boolean;
  message: { kind: MessageKind; deleted: boolean };
  reactions: readonly Pick<Reaction, 'userId' | 'emoji'>[];
  userId: string;
  emoji: string;
}): { ok: true; emoji: string } | { ok: false; error: ReactionError } {
  const { message, reactions, userId } = input;
  if (!input.canReact || message.kind !== 'message' || message.deleted) {
    return { ok: false, error: 'cannot-react' };
  }
  const emoji = normalizeReactionEmoji(input.emoji);
  if (!emoji) return { ok: false, error: 'not-an-emoji' };
  if (reactions.some((r) => r.userId === userId && r.emoji === emoji)) {
    return { ok: false, error: 'already-reacted' };
  }
  const distinct = new Set(reactions.map((r) => r.emoji));
  if (!distinct.has(emoji) && distinct.size >= REACTIONS_MAX_DISTINCT) {
    return { ok: false, error: 'too-many-emoji' };
  }
  return { ok: true, emoji };
}

/** Clicking a chip adds your reaction, or removes it if you'd already reacted with that emoji. */
export function reactionToggle(
  reactions: readonly Pick<Reaction, 'userId' | 'emoji'>[],
  userId: string,
  emoji: string,
): 'add' | 'remove' {
  const wanted = normalizeReactionEmoji(emoji) ?? emoji;
  return reactions.some((r) => r.userId === userId && r.emoji === wanted) ? 'remove' : 'add';
}

export interface ReactionChip {
  emoji: string;
  count: number;
  /** Highlighted: the viewer reacted with this emoji. */
  mine: boolean;
  /** In the order they reacted. */
  userIds: string[];
}

/** Chips under a message, in the order each emoji was first used. */
export function reactionChips(reactions: readonly Reaction[], viewerId: string): ReactionChip[] {
  const byTime = [...reactions].sort((a, b) => a.reactedAt.getTime() - b.reactedAt.getTime());
  const chips = new Map<string, ReactionChip>();
  for (const { emoji, userId } of byTime) {
    const chip = chips.get(emoji) ?? { emoji, count: 0, mine: false, userIds: [] };
    if (chip.userIds.includes(userId)) continue;
    chip.userIds.push(userId);
    chip.count += 1;
    chip.mine ||= userId === viewerId;
    chips.set(emoji, chip);
  }
  return [...chips.values()];
}

/** Who reacted, on hover: "Avery Lin, Sam Ortiz and 2 others". */
export function reactedByText(chip: Pick<ReactionChip, 'userIds'>, nameOf: NameOf): string {
  return listNames(namesOf(chip.userIds, nameOf), 2);
}
