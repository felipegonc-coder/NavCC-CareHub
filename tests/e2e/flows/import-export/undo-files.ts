import { zip, type FilePayload } from './zip-files.js';

// The fictional files of the IE-11 checks. Every title starts with the run's own `name` (from
// uniqueName), so a test can find its own pages in the tree and its own entry in Trash.

/** Markdown pages at `paths` (folders come in as pages too) in a zip named `<name>.zip`. */
function markdownPages(name: string, paths: string[]): FilePayload {
  return {
    name: `${name}.zip`,
    mimeType: 'application/zip',
    buffer: zip(
      paths.map((path) => ({
        path: `${path}.md`,
        data: `# ${path.split('/').pop()}\n\nA fictional note for the import checks.\n`,
      })),
    ),
  };
}

/** Two pages side by side, "<name> intake" and "<name> steps", with no folder above them. */
export function twoPagesZip(name: string): FilePayload & { tree: [string, string] } {
  const tree: [string, string] = [`${name} intake`, `${name} steps`];
  return { ...markdownPages(name, tree), tree };
}

/** `count` pages in the folder `<name>`: enough for the import to still be running at Cancel. */
export function manyPagesZip(name: string, count = 1000): FilePayload {
  const paths = Array.from({ length: count }, (_, i) => `${name}/Page ${i + 1}`);
  return markdownPages(name, paths);
}
