import { isSafeValue, type SchemaInfo } from './check';
import { MAX_DEPTH, isRecord, type PageMark, type PageNode } from './ydoc';

/**
 * Page content from outside the editor (a Markdown comment, JSON from another feature) with only
 * what the live check accepts from an editor: node and mark types the schema knows, the
 * attributes it defines for them, safe values, at most MAX_DEPTH levels from `depth` (where the
 * content goes). Attributes the schema doesn't define are left out; a mark with an unsafe value
 * is dropped, and so is a node with one, with everything in it.
 */
export function cleanContent(value: unknown, info: SchemaInfo, depth = 0): PageNode | null {
  if (!isRecord(value) || typeof value.type !== 'string' || depth > MAX_DEPTH) return null;
  if (value.type === 'text') {
    if (typeof value.text !== 'string' || value.text === '') return null;
    const marks = Array.isArray(value.marks)
      ? value.marks.flatMap((mark: unknown) => cleanMark(mark, info) ?? [])
      : [];
    return marks.length > 0
      ? { type: 'text', text: value.text, marks }
      : { type: 'text', text: value.text };
  }
  if (value.type === 'doc' || !info.nodes.has(value.type)) return null;
  const node: PageNode = { type: value.type };
  if (value.attrs !== undefined) {
    const attrs = cleanAttrs(value.attrs, info.nodeAttrs.get(value.type), info);
    if (!attrs) return null;
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
  }
  if (Array.isArray(value.content)) {
    node.content = value.content.flatMap(
      (child: unknown) => cleanContent(child, info, depth + 1) ?? [],
    );
  }
  return node;
}

function cleanMark(value: unknown, info: SchemaInfo): PageMark | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !info.marks.has(value.type)) {
    return null;
  }
  if (value.attrs === undefined) return { type: value.type };
  const attrs = cleanAttrs(value.attrs, info.markAttrs.get(value.type), info);
  if (!attrs) return null;
  return Object.keys(attrs).length > 0 ? { type: value.type, attrs } : { type: value.type };
}

/** The attributes in `defined`, or null if one of them has an unsafe value. */
function cleanAttrs(
  value: unknown,
  defined: ReadonlySet<string> | undefined,
  info: SchemaInfo,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const attrs: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!defined?.has(key)) continue;
    if (!isSafeValue(key, item, info, 1)) return null;
    attrs[key] = item;
  }
  return attrs;
}
