import { richText, type Block } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderBlock } from '../test-utils';

describe('text block views', () => {
  it('puts headings under the lesson title', () => {
    renderBlock({ id: 'b1', type: 'heading', level: 1, text: 'Before the call' });
    renderBlock({ id: 'b2', type: 'heading', level: 2, text: 'Check the notes' });
    renderBlock({ id: 'b3', type: 'heading', level: 3, text: 'Who is calling' });
    expect(screen.getByRole('heading', { level: 2, name: 'Before the call' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Check the notes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Who is calling' })).toBeInTheDocument();
  });

  it('shows paragraphs as rich text', () => {
    renderBlock({
      id: 'p',
      type: 'paragraph',
      text: richText([{ text: 'Smile', marks: ['bold'] }, { text: ' when you answer.' }]),
    });
    expect(screen.getByText('Smile').tagName).toBe('STRONG');
    expect(screen.getByText('Smile').closest('p')).toHaveTextContent('Smile when you answer.');
  });

  it('shows bulleted and numbered lists', () => {
    const items = [
      { id: 'i1', text: richText('Their name') },
      { id: 'i2', text: richText('Why they are calling') },
    ];
    renderBlock({ id: 'l1', type: 'list', style: 'bulleted', items });
    renderBlock({ id: 'l2', type: 'list', style: 'numbered', items });
    const lists = screen.getAllByRole('list');
    expect(lists.map((list: HTMLElement) => list.tagName)).toEqual(['UL', 'OL']);
    for (const list of lists) expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('lets learners tick a checklist', () => {
    renderBlock({
      id: 'l3',
      type: 'list',
      style: 'checkbox',
      items: [
        { id: 'c1', text: richText('Greet the caller') },
        { id: 'c2', text: richText('Confirm their address') },
      ],
    });
    const greet = screen.getByRole('checkbox', { name: 'Greet the caller' });
    expect(greet).not.toBeChecked();
    fireEvent.click(greet);
    expect(greet).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Confirm their address' })).not.toBeChecked();
  });

  it('shows a callout with its kind and title', () => {
    renderBlock({
      id: 'c',
      type: 'callout',
      tone: 'warning',
      title: 'Never share passwords',
      text: richText('Not even with the IT desk.'),
    });
    renderBlock({ id: 'c2', type: 'callout', tone: 'tip', text: richText('Smile as you talk.') });
    expect(screen.getByRole('note', { name: 'Warning: Never share passwords' })).toHaveTextContent(
      'Not even with the IT desk.',
    );
    expect(screen.getByRole('note', { name: 'Tip' })).toHaveTextContent('Smile as you talk.');
  });

  it('shows statements, quotes and who said them', () => {
    renderBlock({ id: 's', type: 'statement', text: 'Every call matters.' });
    renderBlock({
      id: 'q',
      type: 'quote',
      text: 'They listened to me.',
      attribution: 'Alex, a fictional caller',
    });
    expect(screen.getByText('Every call matters.')).toBeInTheDocument();
    expect(screen.getByText('They listened to me.').tagName).toBe('BLOCKQUOTE');
    expect(screen.getByText('Alex, a fictional caller').tagName).toBe('FIGCAPTION');
  });

  it('shows quotes one at a time', () => {
    renderBlock({
      id: 'qc',
      type: 'quote_carousel',
      quotes: [
        { id: 'q1', text: 'Quick and kind.' },
        { id: 'q2', text: 'Sorted first time.', attribution: 'Sam (fictional)' },
      ],
    });
    expect(screen.getByText('Quick and kind.')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next quote' }));
    expect(screen.getByText('Sorted first time.')).toBeInTheDocument();
    expect(screen.queryByText('Quick and kind.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next quote' }));
    expect(screen.getByText('Quick and kind.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous quote' }));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('shows two columns of text', () => {
    renderBlock({ id: 't', type: 'two_column', left: richText('Do'), right: richText("Don't") });
    expect(screen.getByText('Do')).toBeInTheDocument();
    expect(screen.getByText("Don't")).toBeInTheDocument();
  });

  it('numbers the numbered dividers through the lesson', () => {
    const one: Block = { id: 'd1', type: 'divider', style: 'numbered' };
    const line: Block = { id: 'd2', type: 'divider', style: 'line' };
    const two: Block = { id: 'd3', type: 'divider', style: 'numbered' };
    renderBlock(two, { blocks: [one, line, two] });
    expect(screen.getByRole('separator', { name: 'Part 2' })).toHaveTextContent('2');
    renderBlock(line, { blocks: [one, line, two] });
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('shows code as text to read', () => {
    renderBlock({ id: 'k', type: 'code', language: 'Shortcut', code: 'Ctrl + Shift + H' });
    expect(screen.getByText('Ctrl + Shift + H').tagName).toBe('CODE');
    expect(screen.getByText('Shortcut').tagName).toBe('FIGCAPTION');
  });

  it('shows tables with a header row', () => {
    renderBlock({
      id: 'tb',
      type: 'table',
      headerRow: true,
      rows: [
        ['Day', 'Shift'],
        ['Monday', 'Early'],
      ],
    });
    expect(screen.getByRole('columnheader', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Early' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });
});
