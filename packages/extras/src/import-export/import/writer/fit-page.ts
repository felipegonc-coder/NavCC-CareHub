// A page's content kept within a page's limit (docs/extras/import-export.md#safety), for the
// importers that get documents from the Import screen's HTML reader (Evernote, Confluence).
import { clip, contentSize, IMPORT_LIMITS, type PlanContent, type PlanNode } from '../plan';
import type { PlanWriter } from './plan-writer';

/**
 * `content` within a page's limit: Markdown is cut, a document keeps the blocks that fit. A cut
 * is listed as a problem about `item`.
 */
export function fitPage(content: PlanContent, out: PlanWriter, item: string): PlanContent {
  const max = IMPORT_LIMITS.pageChars;
  if (contentSize(content) <= max) return content;
  out.problem(
    item,
    'Cut short',
    `Only the first ${max.toLocaleString('en-US')} characters were kept.`,
  );
  if ('markdown' in content) return { markdown: clip(content.markdown, max) };
  const kept: PlanNode[] = [];
  let size = JSON.stringify({ ...content.doc, content: [] }).length;
  for (const block of content.doc.content ?? []) {
    const more = JSON.stringify(block).length + (kept.length > 0 ? 1 : 0);
    if (size + more > max) break;
    size += more;
    kept.push(block);
  }
  return { doc: { ...content.doc, content: kept.length > 0 ? kept : [{ type: 'paragraph' }] } };
}
