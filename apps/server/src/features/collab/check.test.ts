import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_BLOCKS,
  MAX_PAGE_BYTES,
  MAX_TEXT_CHARS,
  URL_KEYS,
  checkUpdate,
  pageSchemaInfo,
  type SchemaInfo,
} from './check';
import { MAX_DEPTH, pageFragment, readContent, replaceContent } from './ydoc';

const info = pageSchemaInfo();

/** The page schema plus blocks and marks other lanes may add, for the rules they need. */
const extended: SchemaInfo = {
  ...info,
  nodes: new Set([...info.nodes, 'image']),
  marks: new Set([...info.marks, 'textStyle']),
  nodeAttrs: new Map([...info.nodeAttrs, ['image', new Set(['src', 'alt'])]]),
  markAttrs: new Map([...info.markAttrs, ['textStyle', new Set(['color'])]]),
};

function accepted(blocks: number) {
  return { ok: true, size: { blocks, bytes: expect.any(Number) } };
}

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
    expect(checkUpdate(update, server, info)).toEqual(accepted(3));
  });

  it('accepts a whole page sent to an empty document', () => {
    const update = Y.encodeStateAsUpdate(serverDoc());
    expect(checkUpdate(update, new Y.Doc(), info)).toEqual(accepted(2));
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
    replaceContent(server, [{ type: 'image', attrs: { src: 'https://example.test/a.png' } }]);
    const set = (key: string, value: string) =>
      changeOn(server, (fragment) => (fragment.get(0) as Y.XmlElement).setAttribute(key, value));
    expect(checkUpdate(set('src', '/files/b'), server, extended)).toEqual(accepted(1));
    expect(checkUpdate(set('src', 'javascript:alert(1)'), server, extended)).toEqual({
      ok: false,
      reason: 'unsafe attribute',
    });
    expect(checkUpdate(set('onerror', 'alert(1)'), server, extended)).toEqual({
      ok: false,
      reason: 'unknown attribute',
    });
  });

  it('knows every attribute in the schema, and which of them hold addresses', () => {
    const list = (attrs: ReadonlyMap<string, ReadonlySet<string>>) =>
      [...attrs].flatMap(([name, keys]) =>
        [...keys].map((key) => `${name}.${key}${URL_KEYS.has(key) ? ' (address)' : ''}`),
      );
    expect(list(info.nodeAttrs).sort()).toEqual([
      'codeBlock.language',
      'heading.level',
      'orderedList.start',
      'orderedList.type',
      'taskItem.checked',
    ]);
    expect(list(info.markAttrs).sort()).toEqual([
      'link.class',
      'link.href (address)',
      'link.rel',
      'link.target',
      'link.title',
    ]);
  });

  it('accepts only the attributes the schema defines, on blocks and marks', () => {
    const server = serverDoc();
    const heading = (fragment: Y.XmlFragment) => fragment.get(1) as Y.XmlElement;
    const level = changeOn(server, (fragment) => heading(fragment).setAttribute('level', 3));
    const unknown = changeOn(server, (fragment) => heading(fragment).setAttribute('id', 'x'));
    const linkAttr = changeOn(server, (fragment) => {
      firstText(fragment).format(0, 5, { link: { href: '/guide', onclick: 'alert(1)' } });
    });
    const boldAttr = changeOn(server, (fragment) => {
      firstText(fragment).format(0, 5, { bold: { class: 'x' } });
    });
    expect(checkUpdate(level, server, info)).toEqual(accepted(2));
    expect(checkUpdate(unknown, server, info)).toEqual({ ok: false, reason: 'unknown attribute' });
    expect(checkUpdate(linkAttr, server, info)).toEqual({ ok: false, reason: 'unsafe mark' });
    expect(checkUpdate(boldAttr, server, info)).toEqual({ ok: false, reason: 'unsafe mark' });
  });

  it('accepts only a colour or a keyword where a value goes into CSS', () => {
    const server = serverDoc();
    const colour = (color: string) =>
      changeOn(server, (fragment) => firstText(fragment).format(0, 5, { textStyle: { color } }));
    expect(checkUpdate(colour('#d33f49'), server, extended).ok).toBe(true);
    expect(checkUpdate(colour('teal'), server, extended).ok).toBe(true);
    for (const color of ['red; background: url(/x)', 'expression(alert(1))', '#d33 !important']) {
      expect(checkUpdate(colour(color), server, extended)).toEqual({
        ok: false,
        reason: 'unsafe mark',
      });
    }
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
    expect(checkUpdate(typing, server, info)).toEqual(accepted(1));
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
    expect(checkUpdate(replacing, server, info)).toEqual(accepted(MAX_BLOCKS));

    // A caller's estimate that's too high is corrected by the count.
    const small = serverDoc();
    const update = changeOn(small, (fragment) => fragment.insert(0, [paragraph('New')]));
    const size = { blocks: MAX_BLOCKS, bytes: 100 };
    expect(checkUpdate(update, small, info, size)).toEqual(accepted(3));
  }, 30_000);

  it('refuses an update with too much text', () => {
    const server = serverDoc();
    const most = changeOn(server, (fragment) => {
      firstText(fragment).insert(0, 'x'.repeat(MAX_TEXT_CHARS));
    });
    const tooMuch = changeOn(server, (fragment) => {
      firstText(fragment).insert(0, 'x'.repeat(MAX_TEXT_CHARS + 1));
    });
    expect(checkUpdate(most, server, info).ok).toBe(true);
    expect(checkUpdate(tooMuch, server, info)).toEqual({
      ok: false,
      reason: 'too much text',
      tooLong: true,
    });
  });

  it('refuses an update that takes the page past the size limit, after measuring again', () => {
    const server = new Y.Doc();
    const text = 'x'.repeat(MAX_PAGE_BYTES - 500_000);
    replaceContent(server, [{ type: 'paragraph', content: [{ type: 'text', text }] }]);
    const adding = changeOn(server, (fragment) =>
      firstText(fragment).insert(0, 'y'.repeat(600_000)),
    );
    const deleting = changeOn(server, (fragment) => firstText(fragment).delete(0, 1_000_000));
    expect(checkUpdate(adding, server, info)).toEqual({
      ok: false,
      reason: 'too large',
      tooLong: true,
    });
    // Deletes always go through, so a page that's too large can be made smaller.
    const full = { blocks: 1, bytes: MAX_PAGE_BYTES * 2 };
    expect(checkUpdate(deleting, server, info, full)).toEqual(accepted(1));

    // A caller's size that's too high is corrected by measuring.
    const small = serverDoc();
    const typing = changeOn(small, (fragment) => firstText(fragment).insert(0, 'Hi'));
    const result = checkUpdate(typing, small, info, { blocks: 2, bytes: MAX_PAGE_BYTES });
    expect(result.ok && result.size.bytes < 1_000).toBe(true);
  }, 30_000);
});
