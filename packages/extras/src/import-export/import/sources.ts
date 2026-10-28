/**
 * The sources on the Import screen (Import and export spec, section 3.2), in the order they show.
 * Everything comes from files the person picks (IE-D1): an importer never signs in anywhere.
 */
export const IMPORT_SOURCE_IDS = [
  'markdown',
  'html',
  'word',
  'google-docs',
  'csv',
  'notion',
  'evernote',
  'confluence',
  'trello',
  'asana',
] as const;

export type ImportSourceId = (typeof IMPORT_SOURCE_IDS)[number];

export interface ImportSource {
  id: ImportSourceId;
  label: string;
  /** File name endings the file picker offers. */
  accept: readonly string[];
  /** The "How to get this file" note. */
  howTo: string;
  /** What "File not accepted" says. */
  notAccepted: string;
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  {
    id: 'markdown',
    label: 'Text and Markdown',
    accept: ['.md', '.markdown', '.txt', '.zip'],
    howTo: 'Markdown or text files, or a .zip of them with their pictures.',
    notAccepted: 'Pick a .md, .txt or .zip file.',
  },
  {
    id: 'html',
    label: 'HTML',
    accept: ['.html', '.htm', '.zip'],
    howTo: 'A web page saved as .html, or a .zip of pages with their pictures.',
    notAccepted: 'Pick an .html or .zip file.',
  },
  {
    id: 'word',
    label: 'Word',
    accept: ['.docx'],
    howTo: 'A Word document saved as .docx.',
    notAccepted: 'Pick a .docx file from Word.',
  },
  {
    id: 'google-docs',
    label: 'Google Docs',
    accept: ['.docx'],
    howTo: 'In Google Docs, choose File → Download → Microsoft Word (.docx).',
    notAccepted: 'Pick the .docx file Google Docs downloaded.',
  },
  {
    id: 'csv',
    label: 'CSV and Excel',
    accept: ['.csv', '.tsv', '.xlsx'],
    howTo: 'A .csv or .tsv file, or an Excel workbook. It becomes a database.',
    notAccepted: 'Pick a .csv, .tsv or .xlsx file.',
  },
  {
    id: 'notion',
    label: 'Notion export',
    accept: ['.zip'],
    howTo: 'In Notion, choose Export on a page or in Settings, as "Markdown & CSV" or "HTML".',
    notAccepted: "This zip isn't a Notion export.",
  },
  {
    id: 'evernote',
    label: 'Evernote',
    accept: ['.enex'],
    howTo: 'In Evernote, export one or more notebooks as an .enex file.',
    notAccepted: 'Pick a .enex file from Evernote.',
  },
  {
    id: 'confluence',
    label: 'Confluence',
    accept: ['.zip'],
    howTo: 'In Confluence, export the space as HTML.',
    notAccepted: "This zip isn't a Confluence HTML export.",
  },
  {
    id: 'trello',
    label: 'Trello',
    accept: ['.json'],
    howTo: 'In Trello, open the board menu, then Print, export and share, then Export as JSON.',
    notAccepted: 'Pick the .json export of a Trello board.',
  },
  {
    id: 'asana',
    label: 'Asana',
    accept: ['.csv'],
    howTo: "In Asana, open the project's menu, then Export, then CSV.",
    notAccepted: 'Pick the .csv export of an Asana project.',
  },
];

export function importSource(id: string): ImportSource | undefined {
  return IMPORT_SOURCES.find((source) => source.id === id);
}

/** True when the file's name ends with one of the source's endings (any case). */
export function acceptsFileName(source: ImportSource, fileName: string): boolean {
  const name = fileName.toLowerCase();
  return source.accept.some((ending) => name.endsWith(ending));
}
