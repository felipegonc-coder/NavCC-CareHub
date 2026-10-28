// The template gallery (spec 3.1 and 5): listing, preview, Save as template, changes and starters
// hidden by Admins. Every function checks the person's rights first.
import { tokenizePageIds } from '@carehub/extras/templates/content';
import { readableIds, type StarterDatabaseBuild } from '@carehub/extras/templates/databases';
import {
  galleryCategories,
  TEMPLATE_LIMITS,
  TEMPLATE_MESSAGES,
  type TemplateAudience,
  type TemplateCard,
  type TemplateContents,
  type TemplateIcon,
} from '@carehub/extras/templates/gallery';
import type {
  GalleryResponse,
  SaveTemplateInput,
  TemplatePreviewResponse,
} from '@carehub/extras/templates/schemas';
import { atLeast } from '@carehub/shared';
import { and, asc, eq } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { core, type CorePage, type TemplatesViewer } from './core';
import { tplHiddenStarters, tplTemplatePages, tplTemplates, type TemplateRow } from './schema';
import { STARTERS, STARTERS_BY_KEY, type Starter, type StarterPage } from './starters';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const notFound = () => httpError(404, 'not_found');
export const forbidden = () => httpError(403, 'forbidden');
const tooBig = () => httpError(413, 'too_large', TEMPLATE_MESSAGES.tooBig);

/** A page of a template, ready to copy. */
export interface TemplatePage {
  key: number;
  parentKey: number | null;
  kind: 'page' | 'database';
  isInline: boolean;
  title: string;
  icon: TemplateIcon | null;
  markdown: string;
  sourcePageId: string | null;
  rowCount: number;
  /** A starter's database: what createDatabase makes. */
  database?: StarterDatabaseBuild;
}

interface LoadedTemplate {
  card: TemplateCard;
  pages: TemplatePage[];
  row: TemplateRow | null;
  starter: Starter | null;
}

type RowWithMaker = { template: TemplateRow; byName: string | null };

function starterPages(starter: Starter): TemplatePage[] {
  const pages: TemplatePage[] = [];
  const walk = (page: StarterPage, parentKey: number | null) => {
    const key = pages.length;
    const { title, icon, markdown, database } = page;
    pages.push({
      key,
      parentKey,
      kind: database ? 'database' : 'page',
      isInline: false,
      title,
      icon,
      markdown,
      sourcePageId: null,
      rowCount: database ? database(readableIds).rows.length : 0,
      ...(database ? { database } : {}),
    });
    for (const child of page.children ?? []) walk(child, key);
  };
  walk(starter.page, null);
  return pages;
}

function contentsOf(pages: readonly TemplatePage[]): TemplateContents {
  return {
    subPages: pages.filter((page) => page.key !== 0 && page.kind === 'page').length,
    databases: pages.filter((page) => page.kind === 'database').length,
    sampleRows: pages.reduce((sum, page) => sum + page.rowCount, 0),
  };
}

function starterCard(starter: Starter, viewer: TemplatesViewer, hidden: boolean): TemplateCard {
  const { key, name, description, category, page } = starter;
  return {
    id: key,
    kind: 'starter',
    name,
    description,
    category,
    icon: page.icon,
    by: 'Care Hub',
    contents: contentsOf(starterPages(starter)),
    audience: { type: 'everyone' },
    hidden,
    canManage: viewer.isAdmin,
  };
}

function audienceOf(row: TemplateRow, spaceName?: string): TemplateAudience {
  if (row.audience === 'space' && row.spaceId) {
    return spaceName === undefined
      ? { type: 'space', spaceId: row.spaceId }
      : { type: 'space', spaceId: row.spaceId, spaceName };
  }
  return { type: row.audience === 'me' ? 'me' : 'everyone' };
}

export function workspaceCard(
  { template: row, byName }: RowWithMaker,
  viewer: TemplatesViewer,
  spaceName?: string,
): TemplateCard {
  return {
    id: row.id,
    kind: 'workspace',
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon ?? null,
    by: byName ?? 'a former member',
    contents: {
      subPages: row.subPageCount,
      databases: row.databaseCount,
      sampleRows: row.sampleRowCount,
    },
    audience: audienceOf(row, spaceName),
    hidden: false,
    canManage: viewer.can('templates.manage'),
  };
}

/** The cards this person may see: their own, everyone's, and those of spaces they're in. */
async function visibleCards(db: Db | Tx, viewer: TemplatesViewer, rows: RowWithMaker[]) {
  const spaceIds = new Set<string>();
  for (const { template } of rows) if (template.spaceId) spaceIds.add(template.spaceId);
  const spaces = new Map(
    await Promise.all(
      [...spaceIds].map(async (id) => [id, await core().space(db, viewer.userId, id)] as const),
    ),
  );
  const cards: TemplateCard[] = [];
  for (const row of rows) {
    const { template } = row;
    const space = template.spaceId ? spaces.get(template.spaceId) : null;
    const own = template.createdBy === viewer.userId;
    const sees =
      own ||
      template.audience === 'everyone' ||
      (template.audience === 'space' && space?.isMember === true);
    if (sees) cards.push(workspaceCard(row, viewer, space?.name));
  }
  return cards;
}

const withMaker = { template: tplTemplates, byName: users.name };

async function hiddenStarters(db: Db | Tx, workspaceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: tplHiddenStarters.starterKey })
    .from(tplHiddenStarters)
    .where(eq(tplHiddenStarters.workspaceId, workspaceId));
  return new Set(rows.map((row) => row.key));
}

/** GET /api/templates */
export async function listGallery(db: Db, viewer: TemplatesViewer): Promise<GalleryResponse> {
  const rows = await db
    .select(withMaker)
    .from(tplTemplates)
    .leftJoin(users, eq(users.id, tplTemplates.createdBy))
    .where(eq(tplTemplates.workspaceId, viewer.workspaceId))
    .orderBy(asc(tplTemplates.name), asc(tplTemplates.id));
  const hidden = await hiddenStarters(db, viewer.workspaceId);
  const starters = STARTERS.filter((starter) => viewer.isAdmin || !hidden.has(starter.key)).map(
    (starter) => starterCard(starter, viewer, hidden.has(starter.key)),
  );
  const templates = [...(await visibleCards(db, viewer, rows)), ...starters];
  return {
    templates,
    categories: galleryCategories(templates),
    canSave: viewer.can('templates.manage'),
  };
}

/** A template this person may see (404 otherwise). Hidden starters can't be used. */
export async function loadTemplate(
  db: Db | Tx,
  viewer: TemplatesViewer,
  id: string,
  forUse = false,
): Promise<LoadedTemplate> {
  if (!UUID.test(id)) {
    const starter = STARTERS_BY_KEY.get(id);
    if (!starter) throw notFound();
    const hidden = (await hiddenStarters(db, viewer.workspaceId)).has(id);
    if (hidden && (forUse || !viewer.isAdmin)) throw notFound();
    return {
      card: starterCard(starter, viewer, hidden),
      pages: starterPages(starter),
      row: null,
      starter,
    };
  }
  const found = await db
    .select(withMaker)
    .from(tplTemplates)
    .leftJoin(users, eq(users.id, tplTemplates.createdBy))
    .where(and(eq(tplTemplates.id, id), eq(tplTemplates.workspaceId, viewer.workspaceId)));
  const [card] = await visibleCards(db, viewer, found);
  const row = found[0]?.template;
  if (!card || !row) throw notFound();
  const pages = await db
    .select()
    .from(tplTemplatePages)
    .where(eq(tplTemplatePages.templateId, id))
    .orderBy(asc(tplTemplatePages.key));
  return {
    card,
    pages: pages.map((page) => ({ ...page, icon: page.icon ?? null })),
    row,
    starter: null,
  };
}

/** GET /api/templates/:id */
export async function previewTemplate(
  db: Db,
  viewer: TemplatesViewer,
  id: string,
): Promise<TemplatePreviewResponse> {
  const { card, pages } = await loadTemplate(db, viewer, id);
  return {
    template: card,
    pages: pages.map(({ key, parentKey, kind, title, icon }) => ({
      key,
      parentKey,
      kind,
      title,
      icon,
    })),
    markdown: pages[0]?.markdown ?? '',
  };
}

/** "Members of a space": the space must exist (404); its name, for the card. */
export async function audienceSpace(db: Db, viewer: TemplatesViewer, audience: TemplateAudience) {
  if (audience.type !== 'space') return undefined;
  const space = await core().space(db, viewer.userId, audience.spaceId);
  if (!space) throw notFound();
  return space.name;
}

type TreeEntry = { page: CorePage; key: number; parentKey: number | null; position: number };

/**
 * The page with what comes along, depth first: sub-pages the person can view (if included) and
 * inline databases, which are part of the page's content. Rows come with their database.
 */
async function collectTree(
  db: Db,
  viewer: TemplatesViewer,
  top: CorePage,
  includeSubpages: boolean,
) {
  const entries: TreeEntry[] = [{ page: top, key: 0, parentKey: null, position: 0 }];
  const visit = async (parent: CorePage, parentKey: number) => {
    const children = (await core().children(db, parent.id)).filter(
      (child) =>
        child.kind !== 'row' && (includeSubpages || (child.kind === 'database' && child.isInline)),
    );
    const levels = await core().levels(
      db,
      viewer.userId,
      children.map((child) => child.id),
    );
    let position = 0;
    for (const child of children) {
      if (!atLeast(levels.get(child.id) ?? 'none', 'view')) continue;
      if (entries.length >= TEMPLATE_LIMITS.pages) throw tooBig();
      const key = entries.length;
      entries.push({ page: child, key, parentKey, position: position++ });
      if (child.kind === 'page') await visit(child, key);
    }
  };
  await visit(top, 0);
  return entries;
}

/** POST /api/templates: Save as template. */
export async function saveTemplate(db: Db, viewer: TemplatesViewer, input: SaveTemplateInput) {
  if (!viewer.can('templates.manage')) throw forbidden();
  const found = await core().page(db, viewer.userId, input.pageId);
  if (!found || found.page.workspaceId !== viewer.workspaceId) throw notFound();
  if (!atLeast(found.level, 'view')) throw forbidden();
  if (found.page.kind !== 'page') {
    throw httpError(400, 'invalid', 'Only pages can be saved as templates.');
  }
  const spaceName = await audienceSpace(db, viewer, input.audience);
  const entries = await collectTree(db, viewer, found.page, input.includeSubpages);
  const keys = new Map(entries.map(({ page, key }) => [page.id.toLowerCase(), key]));
  let size = 0;
  const pages: (TemplatePage & { position: number })[] = [];
  for (const { page, key, parentKey, position } of entries) {
    const isDatabase = page.kind === 'database';
    const markdown = isDatabase ? '' : tokenizePageIds(await core().markdown(db, page.id), keys);
    size += Buffer.byteLength(markdown) + Buffer.byteLength(page.title);
    if (size > TEMPLATE_LIMITS.bytes) throw tooBig();
    pages.push({
      key,
      parentKey,
      position,
      kind: isDatabase ? ('database' as const) : ('page' as const),
      isInline: page.isInline,
      title: page.title,
      icon: page.icon,
      markdown,
      sourcePageId: isDatabase ? page.id : null,
      rowCount: isDatabase ? await core().rowCount(db, page.id) : 0,
    });
  }
  const { audience } = input;
  const row = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(tplTemplates)
      .values({
        workspaceId: viewer.workspaceId,
        name: input.name,
        description: input.description,
        category: input.category,
        audience: audience.type,
        spaceId: audience.type === 'space' ? audience.spaceId : null,
        icon: found.page.icon,
        subPageCount: pages.filter((page) => page.key !== 0 && page.kind === 'page').length,
        databaseCount: pages.filter((page) => page.kind === 'database').length,
        sampleRowCount: pages.reduce((sum, page) => sum + page.rowCount, 0),
        sizeBytes: size,
        createdBy: viewer.userId,
        updatedBy: viewer.userId,
      })
      .returning();
    if (!saved) throw new Error('The template was not saved.');
    await tx
      .insert(tplTemplatePages)
      .values(pages.map((page) => ({ ...page, templateId: saved.id })));
    return saved;
  });
  return workspaceCard({ template: row, byName: viewer.name }, viewer, spaceName);
}
