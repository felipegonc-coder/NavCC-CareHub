// Markdown that importers write around text from a file (checklists, file names, links), read
// back by the import with the editor's Markdown rules (HTML off).

/** Backslashes the characters Markdown would read as formatting, so text reads as it was typed. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>~|&$#]/g, '\\$&');
}

/**
 * Plain text (Asana's notes) as Markdown that reads as typed: each line and paragraph kept, and
 * nothing read as formatting, not even a line that starts like a list or a heading.
 */
export function plainTextMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) =>
          escapeMarkdown(line)
            .replace(/^[-+=]/, '\\$&')
            .replace(/^(\d+)([.)])/, '$1\\$2'),
        )
        .join('\\\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

/** `text` on one line, for a list item, a heading or a link. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Spaces, control characters, `(`, `)`, `<`, `>` and `\`: they'd end a link's address early. */
const LINK_UNSAFE = /[^\x21-\x7e\u0080-\uffff]|[()<>\\]/g;

/** A link's address with the characters that could end the link, or start another, %-encoded. */
export function markdownHref(href: string): string {
  return href.replace(
    LINK_UNSAFE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/** `[text](href)`, with the text escaped and the address encoded. */
export function markdownLink(text: string, href: string): string {
  return `[${escapeMarkdown(oneLine(text))}](${markdownHref(href)})`;
}
