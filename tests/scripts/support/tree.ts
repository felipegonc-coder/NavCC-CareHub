import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Relative path → file content; objects are written as JSON. */
export type Tree = Record<string, string | object>;

const created: string[] = [];

/** Writes `files` into a new temporary folder and returns its real path. */
export function makeTree(files: Tree): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'carehub-scripts-')));
  created.push(root);
  writeTree(root, files);
  return root;
}

export function writeTree(root: string, files: Tree): void {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
}

/** Creates the symlink `from` (relative to root) pointing at `to` (relative to root). */
export function link(root: string, from: string, to: string): void {
  const source = path.join(root, from);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.symlinkSync(path.relative(path.dirname(source), path.join(root, to)), source, 'dir');
}

/** Deletes every folder made by makeTree. */
export function removeTrees(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** The package.json of an installed package. */
export const manifest = (name: string, version: string, extra: Record<string, unknown> = {}) => ({
  name,
  version,
  license: 'MIT',
  ...extra,
});
