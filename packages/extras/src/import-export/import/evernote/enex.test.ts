import { describe, expect, it } from 'vitest';
import { createEnexReader, enexDate, NotEnexError, readEnex, type EnexNote } from './enex';
import { XmlError } from './xml';

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261027T120000Z" application="Evernote" version="10.0">
  <note>
    <title>Visit checklist</title>
    <created>20261001T090000Z</created>
    <updated>20261002T101500Z</updated>
    <tag>Intake</tag>
    <tag>Forms</tag>
    <tag>Intake</tag>
    <note-attributes>
      <author>Avery Lin</author>
      <source-url>https://example.test/visits</source-url>
    </note-attributes>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>Bring the <b>forms</b>.</div><en-media hash="0cc175b9c0f1b6a831c399e269772661" type="image/png"/></en-note>]]></content>
    <resource>
      <data encoding="base64">
iVBORw0K
GgoAAAAN
      </data>
      <mime>image/png</mime>
      <resource-attributes>
        <file-name>room.png</file-name>
      </resource-attributes>
    </resource>
  </note>
  <note>
    <title></title>
    <content><![CDATA[<en-note/>]]></content>
  </note>
</en-export>`;

describe('readEnex', () => {
  it("reads each note's fields, content and attachments", () => {
    const [visit, empty] = readEnex(ENEX);
    expect(visit?.content).toContain('<en-note><div>Bring the <b>forms</b>.</div><en-media');
    expect({ ...visit, content: '' }).toEqual({
      title: 'Visit checklist',
      created: '2026-10-01T09:00:00Z',
      updated: '2026-10-02T10:15:00Z',
      tags: ['Intake', 'Forms'],
      author: 'Avery Lin',
      sourceUrl: 'https://example.test/visits',
      content: '',
      resources: [
        { data: 'iVBORw0KGgoAAAAN', mime: 'image/png', fileName: 'room.png', sourceUrl: null },
      ],
    });
    expect(empty).toEqual({
      title: 'Untitled',
      created: null,
      updated: null,
      tags: [],
      author: null,
      sourceUrl: null,
      content: '<en-note/>',
      resources: [],
    });
  });

  it('gives each note as soon as it is read', () => {
    const notes: EnexNote[] = [];
    const reader = createEnexReader((note) => notes.push(note));
    const cut = ENEX.indexOf('<note>', ENEX.indexOf('</note>'));
    reader.push(ENEX.slice(0, cut));
    expect(notes.map((note) => note.title)).toEqual(['Visit checklist']);
    reader.push(ENEX.slice(cut));
    reader.end();
    expect(notes).toHaveLength(2);
  });

  it("says when the file isn't from Evernote, or is damaged", () => {
    expect(() => readEnex('<html><body>Hi</body></html>')).toThrow(NotEnexError);
    expect(() => readEnex('')).toThrow('Pick a .enex file from Evernote.');
    expect(() => readEnex('<en-export><note><title>A</note></en-export>')).toThrow(XmlError);
    expect(() => readEnex('<en-export><note><title>A</title>')).toThrow(XmlError);
  });

  it("reads Evernote's dates", () => {
    expect(enexDate('20261027T143000Z')).toBe('2026-10-27T14:30:00Z');
    expect(enexDate('2026-10-27')).toBeNull();
    expect(enexDate('20261327T143000Z')).toBeNull();
  });
});
