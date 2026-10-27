import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { writeIcons } from './write-icons.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The icons in icons/. iOS puts black behind see-through parts, and Android crops maskable ones. */
const ICONS: Record<string, { size: number; opaque: boolean }> = {
  'apple-touch-icon.png': { size: 180, opaque: true },
  'icon-192.png': { size: 192, opaque: false },
  'icon-512.png': { size: 512, opaque: false },
  'icon-maskable-512.png': { size: 512, opaque: true },
};

/** A PNG's size, from its first chunk (IHDR), and whether it can be see-through. */
function png(bytes: Uint8Array) {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Colour types 4 and 6 have an alpha channel; a tRNS chunk makes the others see-through.
  const colourType = bytes[25];
  const tRNS = new TextDecoder('latin1').decode(bytes).includes('tRNS');
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    seeThrough: colourType === 4 || colourType === 6 || tRNS,
  };
}

describe('write-icons', () => {
  let folder = '';

  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it('writes each icon from its base64 text, at its size', async () => {
    folder = await mkdtemp(join(tmpdir(), 'carehub-icons-'));
    expect(await writeIcons(folder)).toEqual(Object.keys(ICONS).sort());
    for (const [name, { size, opaque }] of Object.entries(ICONS)) {
      const { width, height, seeThrough } = png(await readFile(join(folder, name)));
      expect([name, width, height]).toEqual([name, size, size]);
      if (opaque) expect([name, seeThrough]).toEqual([name, false]);
    }
  });

  // Windows lets only some accounts make symlinks.
  it.skipIf(process.platform === 'win32')('runs as a script, also through a symlink', async () => {
    folder = await mkdtemp(join(tmpdir(), 'carehub-icons-'));
    const script = join(WEB, 'scripts', 'write-icons.mjs');
    await symlink(script, join(folder, 'write-icons.mjs'));
    for (const [run, to] of [
      [script, 'direct'],
      [join(folder, 'write-icons.mjs'), 'linked'],
    ] as const) {
      execFileSync(process.execPath, [run, join(folder, to)]);
      expect((await readdir(join(folder, to))).sort()).toEqual(Object.keys(ICONS).sort());
    }
  });

  it('writes the icons that the manifest and index.html name', async () => {
    const manifest = JSON.parse(
      await readFile(join(WEB, 'public', 'manifest.webmanifest'), 'utf8'),
    );
    const icons = manifest.icons as {
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }[];
    expect(
      icons
        .filter((icon) => icon.type === 'image/png')
        .map((icon) => [icon.src, icon.sizes, icon.purpose ?? 'any']),
    ).toEqual([
      ['/icons/icon-192.png', '192x192', 'any'],
      ['/icons/icon-512.png', '512x512', 'any'],
      ['/icons/icon-maskable-512.png', '512x512', 'maskable'],
    ]);
    for (const icon of icons.filter((entry) => entry.src.startsWith('/icons/'))) {
      expect(Object.keys(ICONS)).toContain(icon.src.slice('/icons/'.length));
    }
    const html = await readFile(join(WEB, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
  });
});
