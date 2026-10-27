import { describe, expect, it } from 'vitest';
import { createXmlReader, decodeEntities, xmlEvents, XmlError, type XmlEvent } from './xml';

describe('xmlEvents', () => {
  it('reads tags, attributes, text, CDATA and references, and skips the rest', () => {
    const events = xmlEvents(
      '<?xml version="1.0"?>\n<!DOCTYPE en-export SYSTEM "x.dtd" [ <!ENTITY boom "lots"> ]>' +
        '<a x="1 &amp; 2" y=\'>\' z=bare><!-- note --><b/>Tom &lt;&#38;&#x1F600;&boom; Jerry' +
        '<![CDATA[<i>as is</i> &amp;]]></a>',
    );
    expect(events).toEqual([
      { type: 'text', text: '\n' },
      { type: 'open', name: 'a', attrs: { x: '1 & 2', y: '>', z: 'bare' }, empty: false },
      { type: 'open', name: 'b', attrs: {}, empty: true },
      { type: 'close', name: 'b' },
      { type: 'text', text: 'Tom <&😀&boom; Jerry' },
      { type: 'text', text: '<i>as is</i> &amp;' },
      { type: 'close', name: 'a' },
    ]);
  });

  it('reads the same events whatever the pieces it gets', () => {
    const text =
      '<note><title>Visit &amp; call</title><!-- a -- b --><content><![CDATA[<en-note>Hi]]>' +
      '</content><?pi x?><data>QUJD\nREVG</data></note>';
    const whole = xmlEvents(text);
    const joined = (events: XmlEvent[]) =>
      events.reduce<XmlEvent[]>((all, event) => {
        const last = all.at(-1);
        if (event.type === 'text' && last?.type === 'text') {
          all[all.length - 1] = { type: 'text', text: last.text + event.text };
        } else {
          all.push(event);
        }
        return all;
      }, []);
    for (const size of [1, 2, 3, 7]) {
      const events: XmlEvent[] = [];
      const reader = createXmlReader((event) => events.push(event));
      for (let at = 0; at < text.length; at += size) reader.push(text.slice(at, at + size));
      reader.end();
      expect(joined(events)).toEqual(joined(whole));
    }
  });

  it('refuses a file that stops inside a tag, or a tag that never ends', () => {
    expect(() => xmlEvents('<a><b')).toThrow(XmlError);
    expect(() => xmlEvents('<a><![CDATA[never')).toThrow(XmlError);
    const reader = createXmlReader(() => {}, { maxToken: 10 });
    expect(() => reader.push('<!-- a comment that is too long')).toThrow(
      'This file has a tag that never ends.',
    );
  });

  it('reads named entities it is given, and leaves unknown and invalid ones', () => {
    expect(decodeEntities('a&nbsp;b &copy; &#0; &#xD800;', { nbsp: '\u00a0' })).toBe(
      'a\u00a0b &copy; &#0; &#xD800;',
    );
    expect(xmlEvents('<p>a&nbsp;b</p>', { entities: { nbsp: '\u00a0' } })[1]).toEqual({
      type: 'text',
      text: 'a\u00a0b',
    });
  });
});
