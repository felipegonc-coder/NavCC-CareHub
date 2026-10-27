import { md5Hex } from '@carehub/extras/import-export/import/evernote/md5';
import { ImportFileError } from '@carehub/extras/import-export/import/plan';
import { describe, expect, it } from 'vitest';
import { enexDate, NOT_ENEX, readEnex, TAGS_PER_NOTE, withoutDoctype } from './enex';
import { enexFile, media, utf8 } from './testing';

const scan = { bytes: utf8('fictional picture'), mime: 'image/png', fileName: 'scan.png' };

function thrown(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('it did not throw');
}

describe('readEnex', () => {
  it('reads each note with its title, dates, tags, content and attachments', () => {
    const notes = readEnex(
      enexFile([
        {
          title: ' Intake call ',
          body: `<div>Call Rowan Diaz.</div>${media(scan)}`,
          created: '20260303T141500Z',
          tags: ['Calls', ' Calls ', 'Follow-up', ''],
          resources: [scan, { bytes: utf8('form'), mime: '' }],
        },
        { title: 'Forms', body: '<div>Send the forms.</div>' },
      ]),
    );
    expect(notes).toHaveLength(2);
    const [intake, forms] = notes;
    expect(intake?.title).toBe('Intake call');
    expect(intake?.created).toBe('2026-03-03T14:15:00Z');
    expect(intake?.updated).toBe('2026-03-02T10:00:00Z');
    expect(intake?.tags).toEqual(['Calls', 'Follow-up']);
    expect(intake?.enml).toContain('<en-note><div>Call Rowan Diaz.</div><en-media hash=');
    expect(intake?.resources.map(({ hash, mime, fileName }) => ({ hash, mime, fileName }))).toEqual(
      [
        { hash: md5Hex(scan.bytes), mime: 'image/png', fileName: 'scan.png' },
        { hash: md5Hex(utf8('form')), mime: 'application/octet-stream', fileName: null },
      ],
    );
    expect(intake?.resources[0]?.bytes).toEqual(scan.bytes);
    expect(forms?.title).toBe('Forms');
    expect(forms?.resources).toEqual([]);
  });

  it('keeps up to 100 tags on a note and skips attachments that are not base64', () => {
    const tags = Array.from({ length: 120 }, (_, i) => `Tag ${i}`);
    const file = enexFile([{ title: 'Tags', body: '', tags }]).replace(
      '</note>',
      '<resource><data>%%%</data><mime>image/png</mime></resource></note>',
    );
    const [note] = readEnex(file);
    expect(note?.tags).toHaveLength(TAGS_PER_NOTE);
    expect(note?.resources).toEqual([]);
  });

  it('reads an export with no notes', () => {
    expect(readEnex('<?xml version="1.0"?><en-export/>')).toEqual([]);
  });

  it("says when the file isn't an Evernote export, or was cut short", () => {
    const cut = enexFile([{ title: 'Intake', body: '' }]).slice(0, -20);
    for (const text of ['', 'Call Rowan', '<html><body>Hi</body></html>', cut]) {
      const error = thrown(() => readEnex(text));
      expect(error).toBeInstanceOf(ImportFileError);
      expect(error.message).toBe(NOT_ENEX);
    }
  });

  it('refuses a DTD of its own, so no entity can expand', () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE en-export [<!ENTITY a "aaaaaaaaaa">]>' +
      '<en-export><note><title>&a;&a;</title></note></en-export>';
    expect(withoutDoctype(bomb)).toBe(bomb);
    const error = thrown(() => readEnex(bomb));
    expect(error).toBeInstanceOf(ImportFileError);
    expect(error.message).toBe(NOT_ENEX);
  });

  it('stops at once past 9,999 notes', () => {
    const notes = '<note><title>n</title></note>'.repeat(10_000);
    const error = thrown(() => readEnex(`<en-export>${notes}</en-export>`));
    expect(error).toBeInstanceOf(ImportFileError);
    expect(error.message).toBe('imports can have up to 10,000 pages');
  });
});

describe('withoutDoctype', () => {
  it("cuts only the line pointing at Evernote's DTD", () => {
    const head = '\uFEFF<?xml version="1.0"?>\n';
    expect(withoutDoctype(`${head}<!DOCTYPE en-export SYSTEM "x.dtd"><en-export/>`)).toBe(
      `${head}<en-export/>`,
    );
    expect(withoutDoctype('<en-export/>')).toBe('<en-export/>');
  });
});

describe('enexDate', () => {
  it("reads Evernote's dates as ISO 8601", () => {
    expect(enexDate('20261027T143000Z')).toBe('2026-10-27T14:30:00Z');
    expect(enexDate('20261341T000000Z')).toBeNull();
    expect(enexDate('yesterday')).toBeNull();
  });
});
