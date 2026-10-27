// Writes the app icons into public/icons/, from the base64 text in icons/. `npm run dev` and
// `npm run build` run it first. The icons are text because the tools that commit to this
// repository can't add binary files; git ignores public/icons/.
import { realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Writes each icons/<name>.png.b64 to <to>/<name>.png and answers the file names written. */
export async function writeIcons(to = join(WEB, 'public', 'icons')) {
  const sources = (await readdir(join(WEB, 'icons'))).filter((name) => name.endsWith('.png.b64'));
  await mkdir(to, { recursive: true });
  const written = [];
  for (const source of sources.sort()) {
    const text = await readFile(join(WEB, 'icons', source), 'utf8');
    const name = source.slice(0, -'.b64'.length);
    await writeFile(join(to, name), Buffer.from(text, 'base64'));
    written.push(name);
  }
  return written;
}

// Run as a script (`node scripts/write-icons.mjs [folder]`), not when its test imports it. Node
// resolves symlinks in import.meta.url but not in argv, so compare real paths.
const script = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (script === fileURLToPath(import.meta.url)) await writeIcons(process.argv[2]);
