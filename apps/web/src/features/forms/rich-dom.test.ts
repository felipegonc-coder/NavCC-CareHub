import { afterEach, describe, expect, it } from 'vitest';
import type { RichText } from '@carehub/databases';
import {
  drawRichText,
  isDrawnAs,
  offsetOf,
  pointAt,
  readPastedHtml,
  readPastedText,
  readRichText,
  readSelection,
  writeSelection,
} from './rich-dom';

function editor(rt: RichText): HTMLDivElement {
  const root = document.createElement('div');
  root.setAttribute('contenteditable', 'true');
  document.body.append(root);
  drawRichText(root, rt);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

const sample: RichText = [
  { text: 'Hi ' },
  { text: 'Avery', marks: ['bold', 'italic'] },
  { text: ', see ' },
  { text: 'the guide', link: 'https://bluepine.example/guide', color: 'blue_background' },
  { text: '\nThanks', marks: ['underline'], color: 'red' },
];

describe('drawing and reading back', () => {
  it('draws each format the way the fill screen does and reads it back', () => {
    const root = editor(sample);
    expect(root.querySelector('strong')?.className).toBe('font-semibold');
    expect(root.querySelector('strong em')).toBeNull();
    expect(root.querySelector('em strong')?.textContent).toBe('Avery');
    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://bluepine.example/guide');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.querySelector('[data-color="blue_background"]')).not.toBeNull();
    expect(root.querySelector('[data-color="red"] u')?.textContent).toBe('\nThanks');
    expect(readRichText(root)).toEqual(sample);
    expect(isDrawnAs(root, sample)).toBe(true);
  });

  it('adds a <br> after a final line break and doesn’t read it as another one', () => {
    const root = editor([{ text: 'Line one\n' }]);
    expect(root.lastChild?.nodeName).toBe('BR');
    expect(readRichText(root)).toEqual([{ text: 'Line one\n' }]);
  });

  it('reads what a browser leaves behind: <b>, <div>, <br> and styled spans', () => {
    const root = editor([]);
    root.innerHTML =
      'One<div>Two <b>bold</b><span style="font-weight: 700"> heavy</span></div><div><br></div>Three<br>';
    expect(readRichText(root)).toEqual([
      { text: 'One\nTwo ' },
      { text: 'bold heavy', marks: ['bold'] },
      { text: '\n\nThree' },
    ]);
    expect(isDrawnAs(root, readRichText(root))).toBe(false);
  });

  it('keeps a mention whole', () => {
    const rt: RichText = [
      { text: 'Ask ' },
      { text: '@Jordan', mention: { kind: 'user', id: 'u2' } },
    ];
    const root = editor(rt);
    expect(root.querySelector('[data-mention]')?.getAttribute('contenteditable')).toBe('false');
    expect(readRichText(root)).toEqual(rt);
  });
});

describe('the selection as offsets', () => {
  it('maps points to offsets and back across formatting and line breaks', () => {
    const root = editor(sample);
    const strongText = root.querySelector('em strong')?.firstChild as Node;
    expect(offsetOf(root, strongText, 2)).toBe(5);
    expect(offsetOf(root, root, 0)).toBe(0);
    expect(offsetOf(root, root, root.childNodes.length)).toBe(30);
    const point = pointAt(root, 5);
    expect(point.node).toBe(strongText);
    expect(point.offset).toBe(2);
    writeSelection(root, { start: 3, end: 8 });
    expect(document.getSelection()?.toString()).toBe('Avery');
    expect(readSelection(root)).toEqual({ start: 3, end: 8 });
  });

  it('puts the caret after a final line break on the empty last line', () => {
    const root = editor([{ text: 'Line one\n' }]);
    const point = pointAt(root, 9);
    expect(point.node).toBe(root);
    expect(root.childNodes[point.offset]?.nodeName).toBe('BR');
    expect(offsetOf(root, point.node, point.offset)).toBe(9);
  });

  it('counts a <br> the browser added as one character', () => {
    const root = editor([]);
    root.innerHTML = 'ab<br>cd';
    expect(offsetOf(root, root.lastChild as Node, 1)).toBe(4);
    expect(pointAt(root, 3).node).toBe(root.lastChild);
  });

  it('is null when the selection is somewhere else', () => {
    const root = editor(sample);
    const other = document.createElement('p');
    other.textContent = 'Elsewhere';
    document.body.append(other);
    document.getSelection()?.selectAllChildren(other);
    expect(readSelection(root)).toBeNull();
  });
});

describe('pasting', () => {
  it('keeps bold, italic, underline, our colours and safe links, and drops the rest', () => {
    const html = `<meta charset="utf-8"><h1 style="font-size: 32px">Big heading</h1>
      <p>Plain <strong>strong</strong> <i>slanted</i> <u>under</u> <s>struck</s> <code>code</code></p>
      <p><span style="color: rgb(255, 0, 0); font-family: Georgia">red font</span>
      <span data-color="green">kit green</span>
      <a href="https://bluepine.example">safe</a> <a href="javascript:alert(1)">unsafe</a></p>
      <script>alert(1)</script><style>p { color: red }</style>`;
    expect(readPastedHtml(html, 2000)).toEqual([
      { text: 'Big heading\nPlain ' },
      { text: 'strong', marks: ['bold'] },
      { text: ' ' },
      { text: 'slanted', marks: ['italic'] },
      { text: ' ' },
      { text: 'under', marks: ['underline'] },
      { text: ' struck code\nred font ' },
      { text: 'kit green', color: 'green' },
      { text: ' ' },
      { text: 'safe', link: 'https://bluepine.example' },
      { text: ' unsafe' },
    ]);
  });

  it('reads Google Docs style markup: a normal-weight <b> wrapper and styled spans', () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700">Heavy</span><span style="font-style:italic"> slanted</span><span style="text-decoration:underline"> lined</span></b>';
    expect(readPastedHtml(html, 2000)).toEqual([
      { text: 'Heavy', marks: ['bold'] },
      { text: ' slanted', marks: ['italic'] },
      { text: ' lined', marks: ['underline'] },
    ]);
  });

  it('collapses spaces like a browser, keeps <pre> spacing and line breaks', () => {
    expect(readPastedHtml('<div>  one\n   two  </div><pre>a  b\nc</pre>x<br>y', 2000)).toEqual([
      { text: 'one two\na  b\nc\nx\ny' },
    ]);
  });

  it('reads plain text with its line breaks and without control characters', () => {
    expect(readPastedText('one\r\ntwo\u0007\tthree')).toEqual([{ text: 'one\ntwo\tthree' }]);
    expect(readPastedText('')).toEqual([]);
  });
});
