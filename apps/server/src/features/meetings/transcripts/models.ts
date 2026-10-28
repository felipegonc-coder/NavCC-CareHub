// The speech model files Care Hub serves for in-browser transcription (Meetings spec, section 3;
// MT-06), read only from the MODELS_DIR folder. Only regular files directly in that folder, with
// plain names, are ever read: no subfolders, links, hidden files or names that reach outside it.
import { constants, type Stats } from 'node:fs';
import { lstat, open, readdir, realpath, type FileHandle } from 'node:fs/promises';
import { extname, join } from 'node:path';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A plain file name: letters, digits, dots, dashes and underscores, never "..". */
export function isSafeModelName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes('..');
}

export interface ModelFile {
  name: string;
  size: number;
  modifiedAt: Date;
}

const fileOf = (name: string, info: Stats): ModelFile => ({
  name,
  size: info.size,
  modifiedAt: info.mtime,
});

/** The model files in the folder, by name; null when the folder can't be read. */
export async function listModelFiles(dir: string): Promise<ModelFile[] | null> {
  let root: string;
  let names: string[];
  try {
    root = await realpath(dir);
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && isSafeModelName(entry.name))
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  const files = await Promise.all(
    names.map(async (name) => {
      const info = await lstat(join(root, name)).catch(() => null);
      return info?.isFile() ? fileOf(name, info) : null;
    }),
  );
  return files.filter((file) => file !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether transcription can run: the folder holds model files. `bytes` is the download size. */
export async function modelsStatus(
  dir: string | null,
): Promise<{ available: boolean; bytes: number }> {
  const files = dir ? await listModelFiles(dir) : null;
  if (!files?.length) return { available: false, bytes: 0 };
  return { available: true, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

/**
 * One model file, opened for reading, or null when the folder has no such regular file. It's
 * opened without following links, so nothing outside the folder can be read through one. The
 * caller closes `handle` (a stream made from it closes it at the end).
 */
export async function openModelFile(
  dir: string,
  name: string,
): Promise<(ModelFile & { handle: FileHandle }) | null> {
  if (!isSafeModelName(name)) return null;
  let handle: FileHandle | undefined;
  try {
    handle = await open(join(await realpath(dir), name), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (info.isFile()) return { ...fileOf(name, info), handle };
  } catch {
    // Missing, a folder or a link: the same answer as a file that isn't there.
  }
  await handle?.close();
  return null;
}

const TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Kept by the browser for a year: a new model comes with new file names. */
export function modelHeaders(file: ModelFile): Record<string, string> {
  const modified = Math.trunc(file.modifiedAt.getTime());
  return {
    'content-type': TYPES[extname(file.name).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'private, max-age=31536000, immutable',
    etag: `"${file.size.toString(36)}-${modified.toString(36)}"`,
    'last-modified': file.modifiedAt.toUTCString(),
    'x-content-type-options': 'nosniff',
  };
}
