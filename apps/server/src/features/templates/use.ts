// Use template (spec 3.1 and 5): a full copy at the chosen place, with links pointing to the copies
// and variables filled in, and "Made from" in its Updates.
import { fillPageTokens, fillVariables } from '@carehub/extras/templates/content';
import type {
  UseTarget,
  UseTemplateInput,
  UseTemplateResponse,
} from '@carehub/extras/templates/schemas';
import { variableValues } from '@carehub/extras/templates/variables';
import { atLeast } from '@carehub/shared';
import { eq, sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { core, type CorePage, type TemplatesViewer } from './core';
import { tplMadeFrom, tplTemplates, type TemplateRow } from './schema';
import { forbidden, loadTemplate, notFound, UUID, type TemplatePage } from './service';
import type { Starter } from './starters';

type Target = { spaceId: string | null; parentId: string | null; applyTo: CorePage | null };

/** "Add to:": Private, a new sub-page, or this page. Needs Can edit there. */
async function resolveTarget(db: Db, viewer: TemplatesViewer, target: UseTarget): Promise<Target> {
  if (target.type === 'private') return { spaceId: null, parentId: null, applyTo: null };
  const found = await core().page(db, viewer.userId, target.pageId);
  if (!found || found.page.workspaceId !== viewer.workspaceId) throw notFound();
  if (!atLeast(found.level, 'edit')) throw forbidden();
  const { page } = found;
  if (page.kind !== 'page') throw httpError(400, 'invalid', 'Pick a page to add the template to.');
  if (target.type === 'page') return { spaceId: page.spaceId, parentId: page.id, applyTo: null };
  if (page.locked) throw httpError(409, 'conflict', 'Unlock the page first.');
  return { spaceId: page.spaceId, parentId: page.parentId, applyTo: page };
}

/** POST /api/templates/:id/use: the copy, with its links pointing to the copies and variables filled. */
export async function useTemplate(
  db: Db,
  viewer: TemplatesViewer,
  id: string,
  input: UseTemplateInput,
): Promise<
  UseTemplateResponse & { pageIds: string[]; row: TemplateRow | null; starter: Starter | null }
> {
  if (!viewer.can('pages.create')) throw forbidden();
  const template = await loadTemplate(db, viewer, id, true);
  const target = await resolveTarget(db, viewer, input.target);
  const by = viewer.userId;
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const ids = new Map<number, string>();
    const titles = new Map<number, string>();
    const notCopied: string[] = [];
    const spaceId = target.spaceId ?? (await core().privateSpaceId(tx, by));
    const make = (page: TemplatePage, parentId: string | null, title: string) =>
      core().createPage(tx, {
        workspaceId: viewer.workspaceId,
        spaceId,
        parentId,
        title,
        icon: page.icon,
        createdBy: by,
      });
    for (const page of template.pages) {
      const title = page.title || (page.key === 0 ? template.card.name : '');
      titles.set(page.key, title);
      if (page.key === 0) {
        const { applyTo } = target;
        if (!applyTo) {
          ids.set(0, await make(page, target.parentId, title));
          continue;
        }
        await core().saveVersionNow(tx, applyTo.id, { reason: 'template', by });
        if (applyTo.title.trim()) titles.set(0, applyTo.title);
        else await core().setTitle(tx, applyTo.id, title, by);
        ids.set(0, applyTo.id);
        continue;
      }
      const parentId = page.parentKey === null ? undefined : ids.get(page.parentKey);
      if (!parentId) continue;
      if (page.kind === 'page') {
        ids.set(page.key, await make(page, parentId, title));
        continue;
      }
      const copy = page.sourcePageId
        ? await core().duplicateDatabase(tx, {
            databaseId: page.sourcePageId,
            parentId,
            includeRows: input.includeSampleRows,
            by,
          })
        : null;
      if (copy) ids.set(page.key, copy);
      else notCopied.push(page.title || 'Untitled');
    }
    for (const page of template.pages) {
      const pageId = ids.get(page.key);
      if (page.kind !== 'page' || !pageId) continue;
      const values = variableValues({
        person: viewer,
        page: { id: pageId, title: titles.get(page.key) ?? '' },
        now,
      });
      let markdown = fillVariables(fillPageTokens(page.markdown, ids), values);
      if (page.key === 0 && target.applyTo) {
        const existing = (await core().markdown(tx, pageId)).trimEnd();
        if (existing) markdown = `${existing}\n\n${markdown}`;
      }
      if (markdown.trim()) await core().setMarkdown(tx, pageId, markdown, by);
    }
    const pageId = ids.get(0);
    if (!pageId) throw new Error('The template’s top page was not made.');
    const madeFrom = {
      workspaceId: viewer.workspaceId,
      templateId: template.row?.id ?? null,
      starterKey: template.starter?.key ?? null,
      templateName: template.card.name,
      usedBy: by,
      usedAt: now,
    };
    await tx
      .insert(tplMadeFrom)
      .values({ pageId, ...madeFrom })
      .onConflictDoUpdate({ target: tplMadeFrom.pageId, set: madeFrom });
    if (template.row) {
      await tx
        .update(tplTemplates)
        .set({ timesUsed: sql`${tplTemplates.timesUsed} + 1` })
        .where(eq(tplTemplates.id, template.row.id));
    }
    return { pageId, notCopied, pageIds: [...ids.values()] };
  });
  return { ...result, row: template.row, starter: template.starter };
}

/** "Made from Weekly huddle", for the page's Updates; null when it wasn't made from a template. */
export async function getMadeFrom(db: Db | Tx, pageId: string) {
  if (!UUID.test(pageId)) return null;
  const [row] = await db
    .select({
      templateName: tplMadeFrom.templateName,
      usedBy: tplMadeFrom.usedBy,
      usedAt: tplMadeFrom.usedAt,
    })
    .from(tplMadeFrom)
    .where(eq(tplMadeFrom.pageId, pageId));
  return row ?? null;
}
