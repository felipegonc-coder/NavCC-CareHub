import { mapInlineNodes, parsePlaceholder, readVariable, variableLabel } from './content';
import { WORKSPACE_CATEGORY, type TemplateCard, type TemplatePreviewPage } from './gallery';

// What the gallery screen shows: cards under a category, a template's pages as an outline and a
// simple read-only reading of its top page (spec section 2).

const BLOCK = /^<!--\s*carehub:block\s+(\{[\s\S]*?\})\s*-->$/;

/** The cards listed under a category: all workspace templates under "Made in this workspace". */
export function inCategory<Card extends TemplateCard>(
  cards: readonly Card[],
  category: string,
): Card[] {
  if (category === WORKSPACE_CATEGORY) return cards.filter((card) => card.kind === 'workspace');
  return cards.filter((card) => card.category === category);
}

/** The pages of a template as an indented outline, the top page first. */
export function outline(
  pages: readonly TemplatePreviewPage[],
): { page: TemplatePreviewPage; depth: number }[] {
  const children = new Map<number | null, TemplatePreviewPage[]>();
  for (const page of pages) {
    const list = children.get(page.parentKey) ?? [];
    list.push(page);
    children.set(page.parentKey, list);
  }
  const rows: { page: TemplatePreviewPage; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (parentKey: number | null, depth: number) => {
    for (const page of children.get(parentKey) ?? []) {
      if (seen.has(page.key)) continue;
      seen.add(page.key);
      rows.push({ page, depth });
      walk(page.key, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** A block of the read-only preview. */
export type PreviewBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'item'; text: string; depth: number; checked?: boolean; ordered?: boolean }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'divider' }
  /** A block without a Markdown form, such as a button: its node name. */
  | { type: 'block'; node: string };

/** Inline Markdown as plain text: marks and links dropped, chips as "@Today". */
function plain(text: string): string {
  return mapInlineNodes(text, (node) => {
    const variable = readVariable(node);
    return variable ? `@${variableLabel(variable.kind, variable.offsetDays)}` : '';
  })
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:strong|em|s|u|code|b|i|del)>/gi, '')
    .replace(/\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')
    .replace(/(\*\*|~~|\*|`)/g, '')
    .replace(/\\([\\`*_[\]<>&~|#!.)+=-])/g, '$1')
    .trim();
}

/** A simple read-only reading of a page's Markdown for the gallery preview (at most `max` blocks). */
export function previewBlocks(markdown: string, max = 60): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length && blocks.length < max; i += 1) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    const fence = /^(`{3,})/.exec(line);
    if (fence?.[1]) {
      const code: string[] = [];
      for (i += 1; i < lines.length && !(lines[i] ?? '').startsWith(fence[1]); i += 1) {
        code.push(lines[i] ?? '');
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const block = BLOCK.exec(line.trim());
    if (block?.[1]) {
      const node = parsePlaceholder(block[1]);
      blocks.push({ type: 'block', node: typeof node?.type === 'string' ? node.type : 'block' });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: plain(heading[2] ?? '') });
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'divider' });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (item) {
      const depth = Math.min(6, Math.floor((item[1] ?? '').length / 2));
      const ordered = /\d/.test(item[2] ?? '');
      const box = item[3];
      blocks.push({
        type: 'item',
        text: plain(item[4] ?? ''),
        depth,
        ...(box === undefined ? {} : { checked: box !== ' ' }),
        ...(ordered ? { ordered } : {}),
      });
      continue;
    }
    if (line.startsWith('>')) {
      blocks.push({ type: 'quote', text: plain(line.replace(/^>\s?/, '')) });
      continue;
    }
    const text = plain(line);
    if (text) blocks.push({ type: 'paragraph', text });
  }
  return blocks;
}
