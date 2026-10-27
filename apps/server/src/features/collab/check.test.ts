import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MAX_BLOCKS, checkUpdate, pageSchemaInfo } from './check';
import { MAX_DEPTH, pageFragment, readContent, replaceContent } from './ydoc';

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

/** `depth` blocks, each inside the one before: lists around a paragraph. */
function nest(depth: number): Y.XmlElement {
  let block = new Y.XmlElement('paragraph');
  for (let level = 1; level < depth; level += 1) {
    const outer = new Y.XmlElement(level % 2 === 1 ? 'listItem' : 'bulletList');
    outer.insert(0, [block]);
    block = outer;
  }
  return block;
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
    // Two blocks plus the new one: deletes aren't subtracted from the estimate.
    expect(checkUpdate(update, server, info)).toEqual({ ok: true, blockCount: 3 });
  });

  it('accepts a whole page sent to an empty document', () => {
    const update = Y.encodeStateAsUpdate(serverDoc());
    expect(checkUpdate(update, new Y.Doc(), info)).toEqual({ ok: true, blockCount: 2 });
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
    expect(checkUpdate(safe, server, info)).toEqual({ ok: true, blockCount: 1 });
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

  it('accepts typing into a block someone just deleted, which Yjs then drops', () => {
    const server = new Y.Doc();
    replaceContent(server, [
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] },
    ]);
    // B types the first letter into the empty paragraph while A deletes it.
    const typing = changeOn(server, (fragment) => {
      const run = new Y.XmlText();
      run.insert(0, 'H');
      (fragment.get(0) as Y.XmlElement).insert(0, [run]);
    });
    const deleting = changeOn(server, (fragment) => fragment.delete(0, 1));
    Y.applyUpdate(server, deleting);
    const before = readContent(server);
    expect(checkUpdate(typing, server, info)).toEqual({ ok: true, blockCount: 1 });
    Y.applyUpdate(server, typing);
    expect(readContent(server)).toEqual(before);
  });

  it('refuses blocks nested deeper than the limit, also below existing blocks', () => {
    const empty = new Y.Doc();
    const deepest = changeOn(empty, (fragment) => fragment.insert(0, [nest(MAX_DEPTH)]));
    const tooDeep = changeOn(empty, (fragment) => fragment.insert(0, [nest(MAX_DEPTH + 1)]));
    expect(checkUpdate(deepest, empty, info).ok).toBe(true);
    expect(checkUpdate(tooDeep, empty, info)).toEqual({ ok: false, reason: 'nested too deeply' });

    const server = new Y.Doc();
    Y.applyUpdate(server, deepest);
    const below = changeOn(server, (fragment) => {
      let block = fragment.get(0) as Y.XmlElement;
      while (block.get(0) instanceof Y.XmlElement) block = block.get(0) as Y.XmlElement;
      block.insert(0, [paragraph('One level too deep')]);
    });
    expect(checkUpdate(below, server, info)).toEqual({ ok: false, reason: 'nested too deeply' });
  });

  it('refuses an update that takes the page past the block limit, after counting again', () => {
    const server = new Y.Doc();
    const blocks = Array.from({ length: MAX_BLOCKS }, () => new Y.XmlElement('paragraph'));
    pageFragment(server).insert(0, blocks);
    const adding = changeOn(server, (fragment) => fragment.insert(0, [paragraph('One more')]));
    const replacing = changeOn(server, (fragment) => {
      fragment.delete(0, 1);
      fragment.insert(0, [paragraph('Instead')]);
    });
    expect(checkUpdate(adding, server, info)).toEqual({
      ok: false,
      reason: 'too many blocks',
      tooLong: true,
    });
    expect(checkUpdate(replacing, server, info)).toEqual({ ok: true, blockCount: MAX_BLOCKS });

    // A caller's estimate that's too high is corrected by the count.
    const small = serverDoc();
    const update = changeOn(small, (fragment) => fragment.insert(0, [paragraph('New')]));
    expect(checkUpdate(update, small, info, MAX_BLOCKS)).toEqual({ ok: true, blockCount: 3 });
  }, 30_000);
});
