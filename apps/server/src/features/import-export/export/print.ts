// GET /api/import-export/print/:pageId (Import and export spec, section 3.3): what the Print view
// shows, which is also how PDFs are made for now (the browser's Save as PDF). The page's content,
// its properties if it's a row, and the pages it points at: their titles only if the viewer can
// open them. Print needs only Can view, so it still works when exports are turned off (IE-16).
import {
  blocksOf,
  referencesIn,
  type ContentNode,
} from '@carehub/extras/import-export/export/content';
import { atLeast } from '@carehub/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../../core/errors';
import type { Db } from '../../../db';
import { viewablePage } from './service';
import { exportSources, type ExportPageInfo } from './sources';

export interface PrintLinkedPage {
  title: string;
  icon: string | null;
}

export interface PrintView {
  page: Pick<ExportPageInfo, 'id' | 'kind' | 'title' | 'icon'>;
  /** A row's properties they can see, as text. */
  properties: { name: string; value: string }[];
  blocks: ContentNode[];
  /** Each page the content points at: its title if they can open it, else null ("No access"). */
  pages: Record<string, PrintLinkedPage | null>;
}

export async function printView(db: Db, userId: string, pageId: string): Promise<PrintView> {
  const page = await viewablePage(db, userId, pageId);
  const sources = exportSources();
  const blocks = blocksOf(await sources.content(db, pageId));
  const ids = [...referencesIn(blocks).pageIds];
  const [levels, found, properties] = await Promise.all([
    sources.access(db, userId, ids),
    sources.pages(db, ids),
    page.kind === 'row' ? sources.rowProperties(db, { userId, rowId: pageId }) : [],
  ]);
  const pages: Record<string, PrintLinkedPage | null> = {};
  for (const id of ids) {
    const linked = found.get(id);
    pages[id] =
      linked && atLeast(levels.get(id) ?? 'none', 'view')
        ? { title: linked.title || 'Untitled', icon: linked.icon }
        : null;
  }
  return {
    page: { id: page.id, kind: page.kind, title: page.title, icon: page.icon },
    properties,
    blocks,
    pages,
  };
}

const params = z.object({ pageId: z.uuid() });

const printRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:pageId', async (request, reply) => {
    const { pageId } = params.parse(request.params);
    if (!request.user) throw httpError(401, 'signed_out');
    const view = await printView(app.db, request.user.id, pageId);
    return reply.header('cache-control', 'private, no-store').send(view);
  });
};

export default printRoutes;
