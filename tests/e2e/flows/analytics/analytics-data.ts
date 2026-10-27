import type { Page } from '@playwright/test';
import { apiFor } from '../_support/index.js';

// Fictional pages and people for the Analytics flows, through the API as the person signed in on
// the page (decision 0007, section 4.1). Analytics records nothing in private spaces (spec,
// section 3), so the pages go in the team space every seeded person is in.

export const MINUTE = 60_000;

/** The team space every seeded person is in, assumed to be the default space "General". */
export const TEAM_SPACE = 'General';

type Space = { id: string; name?: string; kind?: string; type?: string };

/** A new page at the top of the team space; returns its ID. */
export async function makeTeamPage(page: Page, title: string): Promise<string> {
  const api = await apiFor(page);
  const listed = await api.get<Space[] | { spaces: Space[] }>('/api/spaces');
  const spaces = Array.isArray(listed) ? listed : listed.spaces;
  const space =
    spaces.find((each) => each.name === TEAM_SPACE) ??
    spaces.find((each) => (each.kind ?? each.type) === 'team');
  if (!space) throw new Error('GET /api/spaces listed no team space');
  const made = await api.post<{ id?: string; page?: { id: string } }>('/api/pages', {
    spaceId: space.id,
    kind: 'page',
    title,
  });
  const id = made.page?.id ?? made.id;
  if (!id) throw new Error(`POST /api/pages gave no page ID: ${JSON.stringify(made)}`);
  return id;
}

/** A workspace member, as GET /api/workspace/members lists them. */
export type Member = { id: string; name: string; email: string };

/** The member with this email, looked up as the person on `page`. */
export async function member(page: Page, email: string): Promise<Member> {
  const reply = await (
    await apiFor(page)
  ).get<Member[] | { members: Member[] }>(`/api/workspace/members?q=${encodeURIComponent(email)}`);
  const found = (Array.isArray(reply) ? reply : reply.members).find((m) => m.email === email);
  if (!found) throw new Error(`No workspace member ${email}`);
  return found;
}

/** The rows of a CSV file (RFC 4180: quoted fields, doubled quotes, CRLF or LF), blank rows left out. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < source.length; at += 1) {
    const char = source.charAt(at);
    if (quoted) {
      if (char === '"' && source.charAt(at + 1) === '"') {
        cell += '"';
        at += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source.charAt(at + 1) === '\n') at += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows.filter((each) => each.some((value) => value.trim() !== ''));
}
