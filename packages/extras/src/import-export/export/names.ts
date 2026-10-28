// File names and links inside an export (Import and export spec, section 3.3): the page title with
// characters that aren't allowed in file names replaced by "-", trimmed to 100 characters, and
// numbered when two are the same ("Refund steps (2).md"). Paths are relative, so the export works
// offline wherever it's unzipped.

const NOT_ALLOWED = new Set('<>:"/\\|?*');
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const MAX_NAME_LENGTH = 100;

/** A page title as a file name (without its extension). */
export function fileStem(title: string, fallback = 'Untitled'): string {
  const cleaned = Array.from(title.normalize('NFC'), (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127 || NOT_ALLOWED.has(char) ? '-' : char;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  // Trimmed by characters (not UTF-16 units), so an emoji is never cut in half.
  let stem = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  // Windows drops trailing dots and spaces; a leading dot hides the file elsewhere.
  stem = stem.replace(/[. ]+$/, '').replace(/^\./, '-');
  if (stem === '') return fallback;
  return RESERVED.test(stem) ? `${stem}-` : stem;
}

/** A file's own name split into a clean stem and a lowercase extension (`.png`), if it has one. */
export function splitFileName(name: string): { stem: string; ext: string } {
  const match = /^(.*)\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  if (!match || !match[1]) return { stem: fileStem(name, 'File'), ext: '' };
  return { stem: fileStem(match[1], 'File'), ext: `.${(match[2] ?? '').toLowerCase()}` };
}

/**
 * Hands out names in each folder of the export, numbering repeats: "Notes.md", "Notes (2).md".
 * Names are compared ignoring case, as Windows and macOS do. A page takes its `.md` file and its
 * folder (for sub-pages and files) together, so "Notes (2).md" sits next to "Notes (2)/".
 */
export class ExportNames {
  readonly #taken = new Map<string, Set<string>>();

  /** A free stem in `folder` for which every one of `suffixes` is free too; reserves them. */
  take(folder: string, stem: string, suffixes: readonly string[]): string {
    let taken = this.#taken.get(folder);
    if (!taken) {
      taken = new Set();
      this.#taken.set(folder, taken);
    }
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? stem : `${stem} (${n})`;
      const names = suffixes.map((suffix) => `${candidate}${suffix}`.toLowerCase());
      if (names.some((name) => taken.has(name))) continue;
      for (const name of names) taken.add(name);
      return candidate;
    }
  }
}

/** `folder/name`, or `name` at the top of the export. */
export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/** The link from the file at `from` to the file at `to` (both paths inside the export). */
export function relativeLink(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let same = 0;
  while (
    same < fromParts.length &&
    same < toParts.length - 1 &&
    fromParts[same] === toParts[same]
  ) {
    same += 1;
  }
  const up = fromParts.slice(same).map(() => '..');
  return [...up, ...toParts.slice(same)].map(encodeSegment).join('/');
}

/** Encodes one path segment so Markdown and HTML links keep it whole (spaces, brackets, #). */
function encodeSegment(segment: string): string {
  if (segment === '..') return segment;
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
