import {
  IMPORT_LIMITS,
  ImportFileError,
  clip,
  planLink,
  type ImportInput,
  type ImportPlan,
  type ImportZip,
  type Importer,
  type PlanFile,
} from '@carehub/extras/import-export/import/index';
import { htmlToContent } from './html';
import { readWord } from './word';

// Word imports (Import and export spec, section 3.2; IE-02): a .docx file becomes one page, read
// here (word.ts reads the document). Its pictures come along as files. Google Docs' "Download as
// Word" files are read the same way.

const NOT_WORD = "this isn't a Word document";

interface Relationship {
  id: string;
  type: string;
  /** A zip path, or the address of an external one (a link). */
  target: string;
  external: boolean;
}

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** A relationship's target as a zip path, from the folder of the part it's in; null outside. */
export function partPath(folder: string, target: string): string | null {
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Kept as written.
  }
  const path: string[] = [];
  const from = decoded.startsWith('/') ? decoded : `${folder}/${decoded}`;
  for (const part of from.split('/')) {
    if (part === '..' && path.pop() === undefined) return null;
    if (part !== '..' && part !== '.' && part !== '') path.push(part);
  }
  return path.join('/');
}

function parse(xml: string): Document | null {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  return parsed.getElementsByTagName('parsererror').length > 0 ? null : parsed;
}

/** The relationships of the part at `path` ('' for the package's own). */
async function relationships(zip: ImportZip, path: string): Promise<Relationship[]> {
  const folder = folderOf(path);
  const name = path.slice(folder.length > 0 ? folder.length + 1 : 0);
  const rels = `${folder ? `${folder}/` : ''}_rels/${name}.rels`;
  if (!zip.names.includes(rels)) return [];
  const xml = parse(await zip.text(rels));
  const found: Relationship[] = [];
  for (const element of Array.from(xml?.documentElement.children ?? [])) {
    const id = element.getAttribute('Id');
    const target = element.getAttribute('Target');
    if (element.localName !== 'Relationship' || id === null || target === null) continue;
    const external = element.getAttribute('TargetMode') === 'External';
    const resolved = external ? target : partPath(folder, target);
    if (resolved === null) continue;
    found.push({ id, type: element.getAttribute('Type') ?? '', target: resolved, external });
  }
  return found;
}

/** The pages, files and problems of a .docx file. */
export async function planWord(input: ImportInput): Promise<ImportPlan> {
  const { zip } = input;
  if (zip === null) throw new ImportFileError(NOT_WORD);
  const main =
    (await relationships(zip, '')).find((rel) => rel.type.endsWith('/officeDocument'))?.target ??
    'word/document.xml';
  const document = zip.names.includes(main) ? parse(await zip.text(main)) : null;
  if (document === null) throw new ImportFileError(NOT_WORD);
  const rels = await relationships(zip, main);
  const part = async (type: string) => {
    const rel = rels.find((item) => !item.external && item.type.endsWith(`/${type}`));
    return rel && zip.names.includes(rel.target) ? parse(await zip.text(rel.target)) : null;
  };
  const word = readWord(
    {
      document,
      links: new Map(rels.map((rel) => [rel.id, rel.target])),
      styles: await part('styles'),
      numbering: await part('numbering'),
      footnotes: await part('footnotes'),
      endnotes: await part('endnotes'),
    },
    input.fileName,
  );
  const names = new Set(zip.names);
  const files = new Map<string, PlanFile>();
  const { content, problems } = htmlToContent(word.html, {
    source: input.fileName,
    // Web addresses go through as they are; html.ts keeps only the safe ones.
    link: (href) => {
      if (!names.has(href)) return href;
      let file = files.get(href);
      if (!file) {
        file = {
          key: `f${files.size + 1}`,
          name: href.slice(href.lastIndexOf('/') + 1),
          entry: href,
        };
        files.set(href, file);
      }
      return planLink(file.key);
    },
  });
  const title = word.title ?? input.fileName.replace(/\.docx$/i, '').trim();
  return {
    pages: [
      {
        key: 'p1',
        parent: null,
        title: clip(title || 'Untitled', IMPORT_LIMITS.titleChars),
        content,
        source: input.fileName,
      },
    ],
    databases: [],
    files: [...files.values()],
    problems: [...word.problems, ...problems],
  };
}

/** Word: a .docx file. */
export const wordImporter: Importer = { source: 'word', plan: planWord };

/** Google Docs: a document downloaded as Word (.docx). */
export const googleDocsImporter: Importer = { source: 'google-docs', plan: planWord };
