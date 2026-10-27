// The template gallery's names, limits and pure logic (Templates and buttons spec, sections 2 and
// 3.1), shared by the server and the web app.

/** Care Hub's own categories, in the gallery's order, after "Made in this workspace". */
export const STARTER_CATEGORIES = [
  'Meetings',
  'Projects',
  'Knowledge',
  'Team',
  'Support',
  'Planning',
  'Forms',
] as const;

/** The first category: every template saved in this workspace. */
export const WORKSPACE_CATEGORY = 'Made in this workspace';

export const TEMPLATE_LIMITS = {
  /** Pages (sub-pages and databases included) in one template. */
  pages: 500,
  /** Content in one template, in bytes. */
  bytes: 1024 ** 3,
  name: 100,
  description: 300,
  category: 40,
} as const;

export const TEMPLATE_MESSAGES = {
  tooBig: 'Templates can hold up to 500 pages and 1 GB.',
  noResults: 'No templates match your search.',
  hiddenForEveryone: 'Hidden for everyone',
  notCopied: (titles: readonly string[]) =>
    `Couldn't copy ${titles.join(', ')} yet. The rest of the template is ready.`,
  byLine: (by: string) => `by ${by}`,
  editing: (name: string) => `You're editing the template ${name}. Changes only affect new pages.`,
  madeFrom: (name: string) => `Made from ${name}`,
} as const;

/** Starters are Care Hub's own; workspace templates are saved by people here. */
export type TemplateKind = 'starter' | 'workspace';

/** Who sees a workspace template: everyone, the members of one space, or only its maker. */
export type TemplateAudience =
  { type: 'everyone' } | { type: 'space'; spaceId: string; spaceName?: string } | { type: 'me' };

/** A page icon (decision 0007, section 4.1). */
export type TemplateIcon =
  { type: 'emoji'; emoji: string } | { type: 'icon'; name: string; color: string };

/** What comes with a template, besides its top page. */
export interface TemplateContents {
  subPages: number;
  databases: number;
  sampleRows: number;
}

/** A card in the gallery. */
export interface TemplateCard {
  /** A UUID for workspace templates, the starter's key (like `meeting-notes`) for starters. */
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  category: string;
  icon: TemplateIcon | null;
  /** "Care Hub", or the name of the person who saved it. */
  by: string;
  contents: TemplateContents;
  audience: TemplateAudience;
  /** Starters only: an Admin hid it for everyone (only Admins still see it). */
  hidden: boolean;
  /** The person may edit, rename, move, share or delete it (or hide it, for a starter). */
  canManage: boolean;
}

/** A page of a template, for the preview: the top page has `parentKey` null. */
export interface TemplatePreviewPage {
  key: number;
  parentKey: number | null;
  kind: 'page' | 'database';
  title: string;
  icon: TemplateIcon | null;
}

/** "3 sub-pages, 1 database with 6 sample rows", or "Just this page". */
export function describeContents({ subPages, databases, sampleRows }: TemplateContents): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (subPages > 0) parts.push(count(subPages, 'sub-page', 'sub-pages'));
  if (databases > 0) {
    const rows = sampleRows > 0 ? ` with ${count(sampleRows, 'sample row', 'sample rows')}` : '';
    parts.push(`${count(databases, 'database', 'databases')}${rows}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Just this page';
}

/** Lower case without accents, so "Reunión" finds "reunion". */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The gallery's own search: every word must appear in the name, description or category. */
export function matchesSearch(
  card: Pick<TemplateCard, 'name' | 'description' | 'category'>,
  query: string,
): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(`${card.name}\n${card.description}\n${card.category}`);
  return words.every((word) => haystack.includes(word));
}

/** Cards matching the search, names that start with it first, then in their order. */
export function searchTemplates<Card extends TemplateCard>(
  cards: readonly Card[],
  query: string,
): Card[] {
  const found = cards.filter((card) => matchesSearch(card, query));
  const start = fold(query.trim());
  if (!start) return found;
  const rank = (card: Card) => (fold(card.name).startsWith(start) ? 0 : 1);
  return found
    .map((card, index) => ({ card, index }))
    .sort((a, b) => rank(a.card) - rank(b.card) || a.index - b.index)
    .map(({ card }) => card);
}

/**
 * The categories on the left: "Made in this workspace" when there are workspace templates, Care
 * Hub's in their order, then categories people typed, A to Z.
 */
export function galleryCategories(
  cards: readonly Pick<TemplateCard, 'kind' | 'category'>[],
): string[] {
  const starters = new Set<string>(STARTER_CATEGORIES);
  const typed = new Set<string>();
  for (const card of cards) if (!starters.has(card.category)) typed.add(card.category);
  const own = cards.some((card) => card.kind === 'workspace') ? [WORKSPACE_CATEGORY] : [];
  return [...own, ...STARTER_CATEGORIES, ...[...typed].sort((a, b) => a.localeCompare(b))];
}
