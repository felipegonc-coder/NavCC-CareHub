import { describe, expect, it } from 'vitest';
import { ENCRYPTED_LINE, enmlToHtml, type EnmlAttachment } from './enml';

const note = (body: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">' +
  `<en-note>${body}</en-note>`;

const scan: EnmlAttachment = { href: 'carehub-import:file-1', name: 'scan.png', image: true };
const form: EnmlAttachment = { href: 'carehub-import:file-2', name: 'form.pdf', image: false };
const attachments = new Map([
  ['aa11', scan],
  ['bb22', form],
]);

describe('enmlToHtml', () => {
  it('puts pictures and file links where the note shows them', () => {
    const { html, missing } = enmlToHtml(
      note(
        '<div><en-media hash="AA11" type="image/png"/><en-media hash="bb22" type="application/pdf"/> signed</div>',
      ),
      attachments,
    );
    expect(html).toBe(
      '<div><img src="carehub-import:file-1" alt="scan.png"><a href="carehub-import:file-2">form.pdf</a> signed</div>',
    );
    expect(missing).toBe(0);
  });

  it('counts attachments missing from the export and adds the ones the note does not place', () => {
    const { html, missing } = enmlToHtml(
      note('<div>Visit<en-media hash="cc33" type="image/png"/></div>'),
      attachments,
    );
    expect(html).toBe(
      '<div>Visit</div>' +
        '<p><img src="carehub-import:file-1" alt="scan.png"></p>' +
        '<p><a href="carehub-import:file-2">form.pdf</a></p>',
    );
    expect(missing).toBe(1);
  });

  it('says where encrypted text was, without its contents', () => {
    const { html, encrypted } = enmlToHtml(
      note('<div>Code:</div><en-crypt cipher="AES" length="128">U2FsdGVk</en-crypt>'),
      new Map(),
    );
    expect(html).toBe(`<div>Code:</div><p>${ENCRYPTED_LINE}</p>`);
    expect(encrypted).toBe(1);
  });

  it("makes older notes' to-do lines in a row one to-do list", () => {
    const { html } = enmlToHtml(
      note(
        '<div><en-todo checked="true"/>Call Rowan</div>\n<div><en-todo/>Send <b>forms</b></div>' +
          '<div>Notes</div><div>Done: <en-todo checked="true"/>yes</div>',
      ),
      new Map(),
    );
    expect(html).toBe(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true"><p>Call Rowan</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>Send <b>forms</b></p></li></ul>\n' +
        '<div>Notes</div><div>Done: ☑ yes</div>',
    );
  });

  it("marks newer notes' checklists as to-do lists", () => {
    const { html } = enmlToHtml(
      note(
        '<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Intake</div></li>' +
          '<li style="--en-checked:false;"><div>Follow-up</div></li></ul><ul><li>Plain</li></ul>',
      ),
      new Map(),
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = Array.from(doc.querySelectorAll('li'), (item) => [
      item.closest('ul')?.getAttribute('data-type') ?? null,
      item.getAttribute('data-checked'),
      item.textContent,
    ]);
    expect(items).toEqual([
      ['taskList', 'true', 'Intake'],
      ['taskList', 'false', 'Follow-up'],
      [null, null, 'Plain'],
    ]);
  });

  it('turns code blocks into code, a line per line', () => {
    const { html } = enmlToHtml(
      note(
        '<div style="box-sizing: border-box; --en-codeblock:true;"><div>let visits = 3;</div>' +
          '<div><br/></div><div>&lt;done&gt;</div></div>',
      ),
      new Map(),
    );
    expect(html).toBe('<pre><code>let visits = 3;\n\n&lt;done&gt;</code></pre>');
  });
});
