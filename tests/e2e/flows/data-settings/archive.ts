import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { Download } from '@playwright/test';
import { unzip } from '../import-export/zip-files.js';

/**
 * A tar's files by path: ustar names with their prefix, and long names from a pax "path" record
 * or a GNU long-name entry. Folders and other entries are left out.
 */
function untar(file: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const text = (from: number, length: number) =>
    file
      .subarray(from, from + length)
      .toString('utf8')
      .replace(/\0.*$/s, '');
  let longName: string | undefined;
  for (let at = 0; at + 512 <= file.length && file[at] !== 0;) {
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const data = file.subarray(at + 512, at + 512 + size);
    const prefix = text(at + 345, 155);
    const kind = text(at + 156, 1);
    if (kind === 'x') longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1];
    else if (kind === 'L') longName = data.toString('utf8').replace(/\0.*$/s, '');
    else {
      const name = longName ?? (prefix ? `${prefix}/${text(at, 100)}` : text(at, 100));
      if (kind === '' || kind === '0') files.set(name, data);
      longName = undefined;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The files in a downloaded archive, a zip or a .tar.gz, by path. */
export async function archiveFiles(download: Download): Promise<Map<string, Buffer>> {
  const path = await download.path();
  if (!path) throw new Error(`${download.suggestedFilename()} didn't finish downloading.`);
  const bytes = await readFile(path);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return untar(gunzipSync(bytes));
  return unzip(bytes);
}

/** The archive's paths whose path or text holds `text`. */
export function holding(files: Map<string, Buffer>, text: string): string[] {
  return [...files]
    .filter(([path, data]) => path.includes(text) || data.includes(text))
    .map(([path]) => path);
}
