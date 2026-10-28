import { LINK_OPTIONS, createPageSchema } from '@carehub/editor/schema';
import {
  PLAN_LINK,
  resolvePlanLinks,
  type PlanNode,
} from '@carehub/extras/import-export/import/index';

// Page content on its way in: links between the plan's items pointed at what was made, and
// documents from the Import screen checked against the page schema again (they're only data).

/** Where each item of the plan went: `/p/<id>` for pages, databases and rows; a file's URL. */
export type PlanTargets = ReadonlyMap<string, string>;

const KEY = '[A-Za-z0-9_-]{1,64}';
/** A Markdown link or picture still into the plan; its text may hold brackets one level deep. */
const PLAN_MARKDOWN_LINK = new RegExp(
  `!?\\[((?:[^[\\]\\n]|\\[[^[\\]\\n]*\\])*)\\]\\(\\s*<?carehub-import:${KEY}>?(?:\\s+(?:"[^"\\n]*"|'[^'\\n]*'))?\\s*\\)`,
  'g',
);
const PLAN_DEFINITION = new RegExp(
  `^ {0,3}\\[[^\\]\\n]+\\]:[ \\t]*<?carehub-import:${KEY}>?.*$`,
  'gm',
);
const PLAN_ADDRESS = new RegExp(`<?carehub-import:${KEY}>?`, 'g');

/**
 * The Markdown with links into the plan pointed at the new pages and files. One to something that
 * wasn't made (a file left out) keeps only its text.
 */
export function resolveMarkdown(markdown: string, targets: PlanTargets): string {
  return resolvePlanLinks(markdown, (key) => targets.get(key) ?? null)
    .replace(PLAN_MARKDOWN_LINK, (_link, text: string) => text)
    .replace(PLAN_DEFINITION, '')
    .replace(PLAN_ADDRESS, '');
}

/** Blocks may sit this deep, as on the collaboration server (collab/ydoc.ts). */
export const DOC_DEPTH = 100;
/** Attributes whose values a browser may open or load. */
const URL_ATTRS = ['href', 'src', 'url'] as const;

const planKey = (value: unknown) =>
  typeof value === 'string' && value.startsWith(PLAN_LINK) ? value.slice(PLAN_LINK.length) : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMark = (mark: unknown) =>
  isRecord(mark) &&
  typeof mark.type === 'string' &&
  (mark.attrs === undefined || isRecord(mark.attrs));

/** Every node an object with a type and parts of the right kinds, at most DOC_DEPTH deep. */
function isWellFormed(doc: unknown): doc is PlanNode {
  const stack: [unknown, number][] = [[doc, 0]];
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [node, depth] = next;
    if (depth > DOC_DEPTH || !isRecord(node) || typeof node.type !== 'string') return false;
    if (node.attrs !== undefined && !isRecord(node.attrs)) return false;
    if (node.text !== undefined && typeof node.text !== 'string') return false;
    if (node.marks !== undefined && !(Array.isArray(node.marks) && node.marks.every(isMark))) {
      return false;
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return false;
      for (const child of node.content) stack.push([child, depth + 1]);
    }
  }
  return true;
}

/**
 * Links into the plan pointed at what was made. A link to anything else is dropped, and so is a
 * node that needs one (a picture of a file that was left out).
 */
function resolveNode(node: PlanNode, targets: PlanTargets): PlanNode | null {
  let attrs = node.attrs;
  for (const name of URL_ATTRS) {
    const key = planKey(attrs?.[name]);
    if (key === null) continue;
    const target = targets.get(key);
    if (target === undefined) return null;
    attrs = { ...attrs, [name]: target };
  }
  const marks = node.marks?.flatMap((mark) => {
    const key = planKey(mark.attrs?.href);
    if (key === null) return [mark];
    const href = targets.get(key);
    return href === undefined ? [] : [{ ...mark, attrs: { ...mark.attrs, href } }];
  });
  const content = node.content?.flatMap((child) => resolveNode(child, targets) ?? []);
  return {
    ...node,
    ...(attrs && { attrs }),
    ...(marks && { marks }),
    ...(content && { content }),
  };
}

function hasSafeAddresses(node: PlanNode): boolean {
  const safe = (value: unknown) => typeof value !== 'string' || LINK_OPTIONS.isAllowedUri(value);
  return (
    URL_ATTRS.every((name) => safe(node.attrs?.[name])) &&
    (node.marks ?? []).every((mark) => safe(mark.attrs?.href)) &&
    (node.content ?? []).every(hasSafeAddresses)
  );
}

let schema: ReturnType<typeof createPageSchema> | undefined;

/**
 * A document from the Import screen, ready for setPageContent: links resolved, and checked
 * against the page schema (every lane's blocks), its depth and its addresses. Null when it
 * doesn't pass.
 */
export function prepareDoc(doc: unknown, targets: PlanTargets): PlanNode | null {
  if (!isWellFormed(doc) || doc.type !== 'doc') return null;
  const resolved = resolveNode(doc, targets);
  if (!resolved || !hasSafeAddresses(resolved)) return null;
  try {
    schema ??= createPageSchema();
    schema.nodeFromJSON(resolved).check();
  } catch {
    return null;
  }
  return resolved;
}
