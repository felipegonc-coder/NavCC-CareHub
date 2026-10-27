import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { checkUpdate, pageSchemaInfo } from './check';
import { pageFragment, replaceContent } from './ydoc';

const info = pageSchemaInfo();

function serverDoc(): Y.Doc {
  const doc = new Y.Doc();
  replaceContent(doc, [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
  ]);
  return doc;
}

/** The update a client sends after running `change` on its copy of `server`. */
function changeOn(server: Y.Doc, change: (fragment: Y.XmlFragment, doc: Y.Doc) => void) {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const before = Y.encodeStateVector(client);
  change(pageFragment(client), client);
  return Y.encodeStateAsUpdate(client, before);
}

function firstText(fragment: Y.XmlFragment): Y.XmlText {
  return (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;
}

function paragraph(text: string, attributes: Record<string, unknown> = {}): Y.XmlElement {
  const run = new Y.XmlText();
  run.applyDelta([{ insert: text, attributes }]);
  const element = new Y.XmlElement('paragraph');
  element.insert(0, [run]);
  return element;
}

describe('checkUpdate', () => {
  it('accepts typing, marks, safe links, new blocks and deletes', () => {
    const server = serverDoc();
    const update = changeOn(server, (fragment) => {
      firstText(fragment).insert(5, ' there');
      firstText(fragment).format(0, 5, { bold: {} });
      fragment.insert(2, [paragraph('Guide', { link: { href: 'https://example.test/guide' } })]);
      fragment.delete(1, 1);
    });
    expect(checkUpdate(update, server, info)).toEqual({ ok: true, blocks: 1 });
  });

  it('accepts a whole page sent to an empty document', () => {
    const update = Y.encodeStateAsUpdate(serverDoc());
    expect(checkUpdate(update, new Y.Doc(), info)).toEqual({ ok: true, blocks: 2 });
  });

  it('refuses javascript: links on new and existing text', () => {
    const server = serverDoc();
    const added = changeOn(server, (fragment) => {
      fragment.insert(0, [paragraph('Open me', { link: { href: 'javascript:alert(1)' } })]);
    });
    const formatted = changeOn(server, (fragment) => {
      firstText(fragment).format(0, 5, { link: { href: ' JaVaScRiPt:alert(1)' } });
    });
    expect(checkUpdate(added, server, info)).toEqual({ ok: false, reason: 'unsafe mark' });
    expect(checkUpdate(formatted, server, info)).toEqual({ ok: false, reason: 'unsafe mark' });
  });

  it('checks a changed attribute through the block it belongs to', () => {
    const server = new Y.Doc();
    replaceContent(server, [{ type: 'paragraph', attrs: { src: 'https://example.test/a.png' } }]);
    const block = (fragment: Y.XmlFragment) => fragment.get(0) as Y.XmlElement;
    const safe = changeOn(server, (fragment) => block(fragment).setAttribute('src', '/files/b'));
    const unsafe = changeOn(server, (fragment) => {
      block(fragment).setAttribute('src', 'javascript:alert(1)');
    });
    expect(checkUpdate(safe, server, info)).toEqual({ ok: true, blocks: 0 });
    expect(checkUpdate(unsafe, server, info)).toEqual({ ok: false, reason: 'unsafe attribute' });
  });

  it('refuses unknown blocks and marks, embeds, binary values, other fields and junk', () => {
    const server = serverDoc();
    const updates = [
      changeOn(server, (fragment) => fragment.insert(0, [new Y.XmlElement('script')])),
      changeOn(server, (fragment) => firstText(fragment).format(0, 2, { blink: {} })),
      changeOn(server, (fragment) => firstText(fragment).insertEmbed(0, { src: '/x' })),
      changeOn(server, (fragment) => {
        (fragment.get(0) as Y.XmlElement).setAttribute('data', new Uint8Array([1]) as never);
      }),
      changeOn(server, (_fragment, doc) => doc.getMap('extra').set('note', 'hi')),
      Y.encodeStateAsUpdate(serverDoc()).slice(0, 12),
    ];
    for (const update of updates) expect(checkUpdate(update, server, info).ok).toBe(false);
  });
});
