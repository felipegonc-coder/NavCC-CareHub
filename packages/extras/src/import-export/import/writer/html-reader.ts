import type { ImportProblem, PlanContent } from '../plan';

/**
 * The Import screen's HTML reader, which the Evernote and Confluence importers hand their HTML
 * to: the HTML as page content, with the editor's schema as the allowlist. `link` gives each
 * link's and picture's address in the plan, or null to keep only the text (or leave the picture
 * out); `source` names the item in the problems it lists.
 */
export type HtmlToContent = (
  html: string,
  context: { source: string; link: (href: string) => string | null },
) => { content: PlanContent; problems: ImportProblem[] };
