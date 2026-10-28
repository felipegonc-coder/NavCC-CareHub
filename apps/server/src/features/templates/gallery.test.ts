import { randomUUID } from 'node:crypto';
import type { AccessLevel } from '@carehub/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpError } from '../../core/errors';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { bindTemplatesCore, type CorePage } from './core';
import galleryRoutes from './gallery';
import type { TemplateUsedEvent } from './events';
import { tplTemplatePages } from './schema';

const BASE = '/api/test-templates';
const workspaceId = randomUUID();
const supportSpace = randomUUID();
const generalSpace = randomUUID();

/** The stand-in page model: pages with each person's level, their Markdown and sub-pages. */
type FakePage = CorePage & {
  levels: Map<string, AccessLevel>;
  markdown: string;
  childIds: string[];
};
const pages = new Map<string, FakePage>();
const members = new Map<string, { isAdmin: boolean; permissions: string[] }>();
const supportMembers = new Set<string>();
const privateSpaces = new Map<string, string>();
const versions: { pageId: string; reason: string; by: string | null }[] = [];
const copiedDatabases: {
  databaseId: string;
  parentId: string;
  includeRows: boolean;
}[] = [];

function addPage(
  title: string,
  levels: [TestUser, AccessLevel][],
  extra: Partial<FakePage> & { parent?: FakePage } = {},
): FakePage {
  const { parent, ...rest } = extra;
  const page: FakePage = {
    id: randomUUID(),
    workspaceId,
    spaceId: parent?.spaceId ?? generalSpace,
    parentId: parent?.id ?? null,
    kind: 'page',
    isInline: false,
    title,
    icon: null,
    locked: false,
    archived: false,
    levels: new Map(levels.map(([user, level]) => [user.id, level])),
    markdown: '',
    childIds: [],
    ...rest,
  };
  pages.set(page.id, page);
  parent?.childIds.push(page.id);
  return page;
}

describe.skipIf(!hasDatabase)('the template gallery on Postgres', () => {
  let test: TestApp;
  let avery: TestUser; // Admin
  let sam: TestUser; // Editor, in Support
  let jordan: TestUser; // Editor, not in Support
  let riley: TestUser; // Viewer
  let outsider: TestUser; // not a member
  let unbind: (() => void) | undefined;
  const used: TemplateUsedEvent[] = [];

  beforeAll(async () => {
    test = await createTestApp({
      routes: async (app) => {
        await app.register(galleryRoutes, { prefix: BASE });
      },
    });
    avery = await createUser(test.db, {
      name: 'Avery Lin',
      email: 'avery.lin@example.test',
    });
    sam = await createUser(test.db, {
      name: 'Sam Ortiz',
      email: 'sam.ortiz@example.test',
    });
    jordan = await createUser(test.db, {
      name: 'Jordan Reyes',
      email: 'jordan.reyes@example.test',
    });
    riley = await createUser(test.db, {
      name: 'Riley Chen',
      email: 'riley.chen@example.test',
    });
    outsider = await createUser(test.db, {
      name: 'Casey Park',
      email: 'casey.park@example.test',
    });
    const editor = ['templates.manage', 'pages.create'];
    members.set(avery.id, {
      isAdmin: true,
      permissions: [...editor, 'workspace.admin'],
    });
    members.set(sam.id, { isAdmin: false, permissions: editor });
    members.set(jordan.id, { isAdmin: false, permissions: editor });
    members.set(riley.id, { isAdmin: false, permissions: [] });
    supportMembers.add(sam.id);
    unbind = bindTemplatesCore({
      viewer(request) {
        const user = request.user;
        const member = user ? members.get(user.id) : undefined;
        if (!user || !member) throw httpError(403, 'forbidden');
        return {
          userId: user.id,
          name: user.name,
          timeZone: user.timeZone,
          use24h: user.use24h,
          workspaceId,
          isAdmin: member.isAdmin,
          can: (permission) => member.permissions.includes(permission),
        };
      },
      page: async (_db, userId, pageId) => {
        const page = pages.get(pageId);
        return page ? { page, level: page.levels.get(userId) ?? 'none' } : null;
      },
      levels: async (_db, userId, ids) =>
        new Map(ids.map((id) => [id, pages.get(id)?.levels.get(userId) ?? 'none'])),
      children: async (_db, pageId) =>
        (pages.get(pageId)?.childIds ?? []).flatMap((id) => pages.get(id) ?? []),
      space: async (_db, userId, spaceId) =>
        spaceId === supportSpace ? { name: 'Support', isMember: supportMembers.has(userId) } : null,
      privateSpaceId: async (_tx, userId) => {
        const id = privateSpaces.get(userId) ?? randomUUID();
        privateSpaces.set(userId, id);
        return id;
      },
      createPage: async (_tx, input) => {
        const page = addPage(input.title, [], {
          spaceId: input.spaceId,
          icon: input.icon,
          ...(input.parentId ? { parent: pages.get(input.parentId) } : {}),
        });
        page.levels.set(input.createdBy, 'full');
        return page.id;
      },
      setTitle: async (_tx, pageId, title) => {
        const page = pages.get(pageId);
        if (page) page.title = title;
      },
      markdown: async (_db, pageId) => pages.get(pageId)?.markdown ?? '',
      setMarkdown: async (_tx, pageId, markdown) => {
        const page = pages.get(pageId);
        if (page) page.markdown = markdown;
      },
      saveVersionNow: async (_tx, pageId, options) => {
        versions.push({ pageId, ...options });
        return null;
      },
      duplicateDatabase: async (_tx, input) => {
        copiedDatabases.push(input);
        return randomUUID();
      },
      rowCount: async () => 6,
    });
    test.app.events.on('template.used', (event) => {
      used.push(event);
    });
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  const call = (user: TestUser, method: 'GET' | 'POST', url: string, payload?: object) =>
    injectAs(test.app, user, {
      method,
      url: `${BASE}${url}`,
      ...(payload ? { payload } : {}),
    });

  /** "Q4 launch" with an Agenda sub-page it links to, and an inline Tickets database. */
  function launchPage() {
    const top = addPage('Q4 launch', [
      [sam, 'full'],
      [jordan, 'edit'],
      [riley, 'view'],
    ]);
    const agenda = addPage('Agenda', [[sam, 'edit']], { parent: top });
    const tickets = addPage('Tickets', [[sam, 'edit']], {
      parent: top,
      kind: 'database',
      isInline: true,
    });
    addPage('Secret notes', [[jordan, 'full']], { parent: top });
    top.markdown = [
      `Kickoff by <!-- carehub:inline {"type":"templateVariable","attrs":{"kind":"me","offsetDays":0}} -->`,
      '',
      `See [the agenda](</p/${agenda.id}>).`,
      '',
      `<!-- carehub:block {"type":"database","attrs":{"databaseId":"${tickets.id}"}} -->`,
      '',
    ].join('\n');
    agenda.markdown = `Back to [Q4 launch](</p/${top.id}>)\n`;
    return { top, agenda, tickets };
  }

  const save = (user: TestUser, pageId: string, extra: object = {}) =>
    call(user, 'POST', '', {
      pageId,
      name: 'Launch plan',
      description: 'A launch with its agenda',
      category: 'Projects',
      audience: { type: 'space', spaceId: supportSpace },
      ...extra,
    });

  it('lists Care Hub starters by category for members only', async () => {
    const response = await call(riley, 'GET', '');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.canSave).toBe(false);
    expect(body.categories.slice(0, 2)).toEqual(['Meetings', 'Projects']);
    const meeting = body.templates.find((card: { id: string }) => card.id === 'meeting-notes');
    expect(meeting).toMatchObject({
      kind: 'starter',
      by: 'Care Hub',
      category: 'Meetings',
    });
    expect((await call(outsider, 'GET', '')).statusCode).toBe(403);
  });

  it('refuses Save as template without the Templates permission (TB-03)', async () => {
    const { top } = launchPage();
    const response = await save(riley, top.id);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe("You don't have access to this.");
  });

  it('saves a page with its sub-pages and databases, for Members of Support only (TB-02)', async () => {
    const { top, agenda } = launchPage();
    const response = await save(sam, top.id);
    expect(response.statusCode).toBe(201);
    const card = response.json();
    expect(card).toMatchObject({
      kind: 'workspace',
      name: 'Launch plan',
      by: 'Sam Ortiz',
      category: 'Projects',
      audience: { type: 'space', spaceId: supportSpace, spaceName: 'Support' },
      // Secret notes isn't Sam's to see, so it doesn't come along.
      contents: { subPages: 1, databases: 1, sampleRows: 6 },
    });
    const stored = await test.db
      .select()
      .from(tplTemplatePages)
      .where(eq(tplTemplatePages.templateId, card.id))
      .orderBy(tplTemplatePages.key);
    expect(stored.map((page) => [page.key, page.parentKey, page.kind, page.title])).toEqual([
      [0, null, 'page', 'Q4 launch'],
      [1, 0, 'page', 'Agenda'],
      [2, 0, 'database', 'Tickets'],
    ]);
    expect(stored[0]?.markdown).toContain('</p/{{template-page:1}}>');
    expect(stored[0]?.markdown).toContain('"databaseId":"{{template-page:2}}"');
    expect(stored[0]?.markdown).not.toContain(agenda.id);
    expect(stored[1]?.markdown).toContain('</p/{{template-page:0}}>');

    const ids = async (user: TestUser) =>
      (await call(user, 'GET', '')).json().templates.map((found: { id: string }) => found.id);
    expect(await ids(sam)).toContain(card.id);
    expect(await ids(jordan)).not.toContain(card.id);
    expect((await call(jordan, 'GET', `/${card.id}`)).statusCode).toBe(404);
    const preview = await call(sam, 'GET', `/${card.id}`);
    expect(preview.json().pages).toHaveLength(3);
  });

  it('refuses templates over 500 pages', async () => {
    const top = addPage('Huge wiki', [[sam, 'full']]);
    for (let i = 0; i < 500; i += 1) addPage(`Article ${i}`, [[sam, 'view']], { parent: top });
    const response = await save(sam, top.id, { audience: { type: 'me' } });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.message).toBe('Templates can hold up to 500 pages and 1 GB.');
  });

  it('checks what it is sent', async () => {
    const { top } = launchPage();
    expect((await save(sam, top.id, { name: '  ' })).statusCode).toBe(400);
    expect(
      (
        await save(sam, top.id, {
          audience: { type: 'space', spaceId: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    expect((await call(sam, 'GET', '/Not_An_Id!')).statusCode).toBe(400);
  });
});
