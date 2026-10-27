import type { Page } from '@playwright/test';
import { apiFor } from '../_support/index.js';
import { TEAM_SPACE } from './page-screen.js';

type Space = { id: string; name: string };
type Made = { id?: string; page?: { id: string } };

/** The ID of a space the signed-in person is in, by name (GET /api/spaces). */
export async function spaceIdOf(page: Page, name = TEAM_SPACE): Promise<string> {
  const body = await (await apiFor(page)).get<Space[] | { spaces: Space[] }>('/api/spaces');
  const space = (Array.isArray(body) ? body : body.spaces).find((each) => each.name === name);
  if (!space) throw new Error(`"${name}" isn't one of the signed-in person's spaces`);
  return space.id;
}

/**
 * Makes a page as the signed-in person (POST /api/pages) at the top of a space, or inside another
 * page, and returns its ID. For pages a test needs but doesn't check the making of.
 */
export async function makePage(
  page: Page,
  title: string,
  where: { parentId: string } | { space: string } = { space: TEAM_SPACE },
): Promise<string> {
  const home = 'parentId' in where ? where : { spaceId: await spaceIdOf(page, where.space) };
  const api = await apiFor(page);
  const made = await api.post<Made>('/api/pages', { kind: 'page', title, ...home });
  const id = made.page?.id ?? made.id;
  if (!id) throw new Error(`POST /api/pages answered without a page ID: ${JSON.stringify(made)}`);
  return id;
}
