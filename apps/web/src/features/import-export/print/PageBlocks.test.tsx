import { blocksOf } from '@carehub/extras/import-export/export/content';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageBlocks, printHref } from './PageBlocks';

const LINKED = '9d3b7a10-2c4e-4f6a-8b1d-5e7f9a0b2c3d';
const HIDDEN = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CHART = '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7';
const pages = { [LINKED]: { title: 'Intake checklist', icon: '📋' }, [HIDDEN]: null };

const text = (value: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks } : {}),
});
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const cell = (type: string, value: string) => ({ type, content: [p(text(value))] });

function blocks(content: unknown[], openAll = false) {
  return <PageBlocks blocks={blocksOf(content)} pages={pages} openAll={openAll} />;
}

describe('PageBlocks', () => {
  it('puts headings one level under the page title', () => {
    render(
      blocks([
        { type: 'heading', attrs: { level: 1 }, content: [text('Before the visit')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Parking')] },
      ]),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Before the visit' })).toHaveClass(
      'text-h1',
    );
    expect(screen.getByRole('heading', { level: 4, name: 'Parking' })).toBeInTheDocument();
  });

  it('keeps marks and colours, and only links that are safe', () => {
    render(
      blocks([
        p(
          text('Call '),
          text('Avery', { type: 'bold' }),
          text('today', { type: 'textStyle', attrs: { color: 'red' } }),
          text('the map', { type: 'link', attrs: { href: 'https://example.test/map' } }),
          text('the trick', { type: 'italic' }, { type: 'link', attrs: { href: 'javascript:1' } }),
        ),
      ]),
    );
    expect(screen.getByText('Avery').tagName).toBe('STRONG');
    expect(screen.getByText('today')).toHaveClass('text-red-text');
    expect(screen.getByRole('link', { name: 'the map' })).toHaveAttribute(
      'href',
      'https://example.test/map',
    );
    expect(screen.getByText('the trick').tagName).toBe('EM');
    expect(screen.getByText('the trick').closest('a')).toBeNull();
    expect(printHref(`/p/${LINKED}#notes`)).toBe(`/p/${LINKED}#notes`);
    expect(printHref('//example.test/p')).toBeNull();
  });

  it('titles the pages they can open, and says No access for the rest', () => {
    render(
      blocks([
        p({ type: 'mention', attrs: { kind: 'page', id: LINKED } }, text(' and ')),
        p({ type: 'pageMention', attrs: { pageId: HIDDEN } }),
        { type: 'subPage', attrs: { pageId: LINKED } },
      ]),
    );
    const links = screen.getAllByRole('link', { name: '📋 Intake checklist' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', `/p/${LINKED}`);
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('shows the inline databases they can open as their view, as tables', () => {
    const VIEW = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
    render(
      <PageBlocks
        blocks={blocksOf([
          { type: 'inlineDatabase', attrs: { databaseId: LINKED, viewId: VIEW } },
          { type: 'inlineDatabase', attrs: { databaseId: LINKED } },
          { type: 'inlineDatabase', attrs: { databaseId: HIDDEN } },
        ])}
        pages={pages}
        databases={[
          {
            databaseId: LINKED,
            viewId: VIEW,
            rows: [['Client', 'Visits'], ['Rowan Diaz', '4'], ['Sam Ortiz']],
          },
        ]}
        openAll={false}
      />,
    );
    const table = screen.getByRole('table', { name: '📋 Intake checklist' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Client', 'Visits']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('cell')).toHaveLength(4);
    // Without its view's rows it's a link to the database, and No access when they can't open it.
    expect(screen.getAllByRole('link', { name: '📋 Intake checklist' })).toHaveLength(2);
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('shows pictures with their alt text and caption, and files as links', () => {
    render(
      blocks([
        {
          type: 'image',
          attrs: { src: `/api/files/${CHART}`, alt: 'Visits per week', caption: 'October' },
        },
        { type: 'image', attrs: { src: 'javascript:alert(1)' } },
        { type: 'file', attrs: { fileId: CHART, name: 'Care plan.pdf' } },
      ]),
    );
    expect(screen.getByRole('img', { name: 'Visits per week' })).toHaveAttribute(
      'src',
      `/api/files/${CHART}`,
    );
    expect(screen.getByText('October').tagName).toBe('FIGCAPTION');
    expect(screen.getByText('Picture not included')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Care plan.pdf' })).toHaveAttribute(
      'href',
      `/api/files/${CHART}`,
    );
  });

  it('shows toggles as they were left, or all open', () => {
    const content = [
      { type: 'toggle', content: [p(text('Visitor badge')), p(text('At the front desk.'))] },
      { type: 'toggle', attrs: { open: true }, content: [p(text('Parking')), p(text('Street.'))] },
    ];
    const { rerender } = render(blocks(content));
    expect(screen.getByText('Visitor badge').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Parking').closest('details')).toHaveAttribute('open');
    rerender(blocks(content, true));
    expect(screen.getByText('Visitor badge').closest('details')).toHaveAttribute('open');
  });

  it('draws lists, to-dos, code, tables and callouts', () => {
    render(
      blocks([
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('Gloves'))] }] },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [p(text('Wash hands'))] }],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(text('Call the family'))] },
            { type: 'taskItem', content: [p(text('Book the van'))] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const visits = 3;')] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [cell('tableHeader', 'Day'), cell('tableHeader', 'Visits')],
            },
            { type: 'tableRow', content: [cell('tableCell', 'Monday'), cell('tableCell', '4')] },
          ],
        },
        { type: 'callout', attrs: { color: 'yellow_background' }, content: [p(text('Check it'))] },
      ]),
    );
    expect(screen.getByText('Gloves').closest('ul')).toHaveClass('list-disc');
    expect(screen.getByText('Wash hands').closest('ol')).toHaveAttribute('start', '3');
    expect(screen.getByText('Call the family').closest('li')).toHaveTextContent(
      'Done: Call the family',
    );
    expect(screen.getByText('Book the van').closest('li')).toHaveTextContent('To do: Book the van');
    expect(screen.getByText('const visits = 3;').closest('pre')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Monday' })).toBeInTheDocument();
    expect(screen.getByText('Check it').closest('.ch-print-callout')).toHaveClass('bg-yellow-bg');
  });
});
