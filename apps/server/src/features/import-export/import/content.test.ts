import { describe, expect, it } from 'vitest';
import type { PlanNode } from '@carehub/extras/import-export/import/index';
import { DOC_DEPTH, prepareDoc, resolveMarkdown } from './content';

const targets = new Map([
  ['p1', '/p/00000000-0000-4000-8000-000000000001'],
  ['f1', '/api/files/00000000-0000-4000-8000-0000000000f1'],
]);
const page = targets.get('p1');
const file = targets.get('f1');

describe('resolveMarkdown', () => {
  it('points links and pictures at the new pages and files', () => {
    expect(resolveMarkdown('[![Desk](carehub-import:f9)](carehub-import:p1)', targets)).toBe(
      `[Desk](${page})`,
    );
    expect(
      resolveMarkdown(
        'See [Intake](carehub-import:p1) and ![Desk](carehub-import:f1 "Front").',
        targets,
      ),
    ).toBe(`See [Intake](${page}) and ![Desk](${file} "Front").`);
  });

  it('keeps only the text of links to what was left out', () => {
    expect(
      resolveMarkdown(
        'A [gone](carehub-import:p9) link, ![lost](carehub-import:f9 "x"), [a [b] c](carehub-import:p9) and <carehub-import:p8>.',
        targets,
      ),
    ).toBe('A gone link, lost, a [b] c and .');
  });

  it('drops reference definitions to what was left out', () => {
    expect(
      resolveMarkdown(
        '[b][r] [c][s]\n\n[r]: carehub-import:p1\n[s]: carehub-import:p9 "t"\n',
        targets,
      ),
    ).toBe(`[b][r] [c][s]\n\n[r]: ${page}\n\n`);
  });

  it('leaves other links alone', () => {
    const text = '[site](https://example.org/a.md) [top](#top) and `code`';
    expect(resolveMarkdown(text, targets)).toBe(text);
  });
});

const text = (value: string, marks?: PlanNode['marks']): PlanNode => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const paragraph = (...content: PlanNode[]): PlanNode => ({ type: 'paragraph', content });
const doc = (...content: PlanNode[]): PlanNode => ({ type: 'doc', content });
const link = (href: string) => ({ type: 'link', attrs: { href } });

describe('prepareDoc', () => {
  it('points links at the new pages and drops links and nodes to what was left out', () => {
    const picture = { type: 'image', attrs: { src: 'carehub-import:f9' } };
    expect(
      prepareDoc(
        doc(
          paragraph(
            text('Intake', [link('carehub-import:p1')]),
            text(' and '),
            text('gone', [link('carehub-import:p9')]),
          ),
          picture,
        ),
        targets,
      ),
    ).toEqual(doc(paragraph(text('Intake', [link(page ?? '')]), text(' and '), text('gone', []))));
  });

  it('takes documents as deep as the editor allows', () => {
    let node = paragraph(text('Deep'));
    for (let level = 0; level < 10; level += 1) node = { type: 'blockquote', content: [node] };
    expect(prepareDoc(doc(node), targets)).toEqual(doc(node));
  });

  it('refuses documents that are badly formed, too deep, unsafe or not in the page schema', () => {
    let deep = paragraph(text('Deep'));
    for (let level = 0; level < DOC_DEPTH; level += 1)
      deep = { type: 'blockquote', content: [deep] };
    for (const bad of [
      paragraph(text('Not a document')),
      { type: 'doc', content: 'text' },
      { type: 'doc', content: [{ type: 'paragraph', marks: 'bold' }] },
      doc(deep),
      doc(paragraph(text('Run', [link('javascript:alert(1)')]))),
      doc({ type: 'iframe', attrs: { src: 'https://example.org' } }),
      doc(paragraph(text(''))),
    ]) {
      expect(prepareDoc(bad, targets)).toBeNull();
    }
  });
});
