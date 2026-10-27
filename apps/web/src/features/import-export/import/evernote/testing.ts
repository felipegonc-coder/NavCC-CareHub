// Fictional .enex files for the Evernote importer's tests.
import { md5Hex } from '@carehub/extras/import-export/import/evernote/md5';

export const utf8 = (text: string) => new TextEncoder().encode(text);

export const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

export interface FixtureResource {
  bytes: Uint8Array;
  mime: string;
  fileName?: string;
}

export interface FixtureNote {
  title: string;
  /** The inside of <en-note>. */
  body: string;
  created?: string;
  updated?: string;
  tags?: string[];
  resources?: FixtureResource[];
}

/** `<en-media>` for a resource, by the MD5 of its bytes. */
export const media = (resource: FixtureResource) =>
  `<en-media hash="${md5Hex(resource.bytes)}" type="${resource.mime}"/>`;

function noteXml(note: FixtureNote): string {
  const enml =
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">' +
    `<en-note>${note.body}</en-note>`;
  const resources = (note.resources ?? []).map(
    (resource) =>
      `<resource><data encoding="base64">\n${base64(resource.bytes)}\n</data>` +
      `<mime>${resource.mime}</mime>` +
      (resource.fileName
        ? `<resource-attributes><file-name>${resource.fileName}</file-name></resource-attributes>`
        : '') +
      '</resource>',
  );
  return [
    `<note><title>${note.title}</title>`,
    `<created>${note.created ?? '20260301T090000Z'}</created>`,
    `<updated>${note.updated ?? '20260302T100000Z'}</updated>`,
    ...(note.tags ?? []).map((tag) => `<tag>${tag}</tag>`),
    `<content><![CDATA[${enml}]]></content>`,
    ...resources,
    '</note>',
  ].join('\n');
}

/** An Evernote export of `notes`, with the DOCTYPE line Evernote writes. */
export const enexFile = (notes: FixtureNote[]) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n' +
  '<en-export export-date="20261027T120000Z" application="Evernote" version="10.105.4">\n' +
  notes.map(noteXml).join('\n') +
  '\n</en-export>\n';
