import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { apiFor, uniqueName } from '../_support/index.js';

// Fictional people, pages and pictures for the Settings and members flows. Pages go through the
// API as the person signed in on the page (decision 0007, section 4.1).

/** The signed-in person as GET /api/auth/me tells it (#55): their membership, or null. */
export type Me = {
  user: { id: string; name: string; email: string };
  member: { kind: 'member' | 'guest'; roleName: string | null; isAdmin: boolean } | null;
};

export async function me(page: Page): Promise<Me> {
  return (await apiFor(page)).get<Me>('/api/auth/me');
}

/** A workspace member, as GET /api/workspace/members lists them. */
export type Member = { id: string; name: string; email: string; roleName?: string };

/** The member with this email, looked up as the person on `page`. */
export async function member(page: Page, email: string): Promise<Member> {
  const reply = await (
    await apiFor(page)
  ).get<Member[] | { members: Member[] }>(`/api/workspace/members?q=${encodeURIComponent(email)}`);
  const found = (Array.isArray(reply) ? reply : reply.members).find((m) => m.email === email);
  if (!found) throw new Error(`No workspace member ${email}`);
  return found;
}

/** Someone new, who joins with an invite link: a unique fictional name, email and password. */
export function newPerson(firstName: string) {
  const name = uniqueName(`${firstName} QA`);
  const tag = name.split(' ').at(-1) ?? randomUUID().slice(0, 6);
  return {
    name,
    email: `${firstName.toLowerCase()}.qa.${tag}@example.test`,
    // Made up for this run only (12+ characters, not a common password).
    password: `Fictional-${randomUUID()}`,
  };
}
export type NewPerson = ReturnType<typeof newPerson>;

type Space = { id: string; name?: string; kind?: string; type?: string };

/** A new page at the top of the team space "General", which every member can open. */
export async function makeTeamPage(page: Page, title: string): Promise<string> {
  const api = await apiFor(page);
  const listed = await api.get<Space[] | { spaces: Space[] }>('/api/spaces');
  const spaces = Array.isArray(listed) ? listed : listed.spaces;
  const space =
    spaces.find((each) => each.name === 'General') ??
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

// ---- Pictures ----

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A plain fictional picture: a `size` × `size` PNG in one color. `padTo` bytes pads it with a
 * text chunk, for a file over the 5 MB limit that is still a real PNG.
 */
export function picture(size = 96, padTo = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(size * 3, Buffer.from([31, 122, 140])),
  ]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  const parts = [chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))];
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const plain = Buffer.concat([signature, ...parts]);
  if (plain.length >= padTo) return plain;
  const filler = Buffer.concat([
    Buffer.from('Comment\0', 'latin1'),
    Buffer.alloc(padTo - plain.length - 20, 'x'),
  ]);
  return Buffer.concat([
    signature,
    parts[0] ?? Buffer.alloc(0),
    chunk('tEXt', filler),
    ...parts.slice(1),
  ]);
}

export const MB = 1024 * 1024;
