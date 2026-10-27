import { createCourse } from '@carehub/learning';
import type { Block } from '@carehub/learning';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BlockEditorFor } from '../registry';

// Fictional data only.
const course = createCourse({ type: 'standard', title: 'Hand hygiene' });

/** Shows the editor for `initial` and keeps every change, like the canvas does. */
function edit(initial: Block) {
  const seen: Block[] = [];
  function Harness() {
    const [block, setBlock] = useState(initial);
    return (
      <BlockEditorFor
        block={block}
        course={course}
        lessonId="lesson-1"
        onChange={(next) => {
          seen.push(next);
          setBlock(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { latest: () => seen.at(-1) };
}

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('text block editors', () => {
  it('edit a heading: its size and text', () => {
    const { latest } = edit({ id: 'b1', type: 'heading', level: 2, text: 'Before you start' });
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    press('Small');
    type('Heading text', 'The five moments');
    expect(latest()).toEqual({ id: 'b1', type: 'heading', level: 3, text: 'The five moments' });
    expect(screen.getByRole('button', { name: 'Small' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('edit a paragraph as paragraphs of text', () => {
    const { latest } = edit({ id: 'b1', type: 'paragraph', text: [] });
    type('Paragraph text', 'Wet your hands.\n\nUse soap.');
    expect(latest()).toEqual({
      id: 'b1',
      type: 'paragraph',
      text: [{ runs: [{ text: 'Wet your hands.' }] }, { runs: [{ text: 'Use soap.' }] }],
    });
  });

  it('edit a note: kind, optional title and text', () => {
    const { latest } = edit({ id: 'b1', type: 'callout', tone: 'note', text: [] });
    press('Warning');
    type('Title', 'Gloves are not enough');
    type('Note text', 'Clean your hands after taking gloves off.');
    expect(latest()).toEqual({
      id: 'b1',
      type: 'callout',
      tone: 'warning',
      title: 'Gloves are not enough',
      text: [{ runs: [{ text: 'Clean your hands after taking gloves off.' }] }],
    });
    type('Title', '');
    expect(latest()).not.toHaveProperty('title');
  });

  it('edit statements and quotes, leaving out who said it when blank', () => {
    edit({ id: 'b1', type: 'statement', text: '' });
    type('Statement', 'Clean hands save lives.');
    expect(screen.getByRole('textbox', { name: 'Statement' })).toHaveValue(
      'Clean hands save lives.',
    );

    const { latest } = edit({ id: 'b2', type: 'quote', text: '', attribution: 'A nurse' });
    type('Quote', 'It takes twenty seconds.');
    type('Who said it', '  ');
    expect(latest()).toEqual({ id: 'b2', type: 'quote', text: 'It takes twenty seconds.' });
  });

  it('edit both columns', () => {
    const { latest } = edit({ id: 'b1', type: 'two_column', left: [], right: [] });
    type('Left column', 'Soap and water');
    type('Right column', 'Hand rub');
    expect(latest()).toMatchObject({
      left: [{ runs: [{ text: 'Soap and water' }] }],
      right: [{ runs: [{ text: 'Hand rub' }] }],
    });
  });

  it('pick a divider style', () => {
    const { latest } = edit({ id: 'b1', type: 'divider', style: 'line' });
    press('Space');
    expect(latest()).toEqual({ id: 'b1', type: 'divider', style: 'spacer' });
  });

  it('edit code and its optional language', () => {
    const { latest } = edit({ id: 'b1', type: 'code', code: '' });
    type('Language', 'SQL');
    type('Code', 'select 1;');
    expect(latest()).toEqual({ id: 'b1', type: 'code', language: 'SQL', code: 'select 1;' });
    type('Language', '');
    expect(latest()).toEqual({ id: 'b1', type: 'code', code: 'select 1;' });
  });

  it('set what a continue button says and when the rest shows', () => {
    const { latest } = edit({ id: 'b1', type: 'continue', requires: 'click' });
    expect(screen.getByRole('textbox', { name: 'Button label' })).toHaveAttribute(
      'placeholder',
      'Continue',
    );
    type('Button label', 'I have washed my hands');
    press('Everything above is done');
    expect(latest()).toEqual({
      id: 'b1',
      type: 'continue',
      label: 'I have washed my hands',
      requires: 'complete_above',
    });
  });

  it('edit a list: style, items added, typed and removed', () => {
    const { latest } = edit({
      id: 'b1',
      type: 'list',
      style: 'bulleted',
      items: [{ id: 'i1', text: [{ runs: [{ text: 'Wet' }] }] }],
    });
    press('Numbers');
    press('Add item');
    type('Item 2', 'Soap');
    press('Remove item 1');
    const block = latest();
    expect(block?.type === 'list' && block.style).toBe('numbered');
    expect(block?.type === 'list' && block.items.map((item) => item.text)).toEqual([
      [{ runs: [{ text: 'Soap' }] }],
    ]);
    expect(screen.getByRole('textbox', { name: 'Item 1' })).toHaveValue('Soap');
  });

  it('edit a quote carousel: quotes added, typed and removed', () => {
    const { latest } = edit({ id: 'b1', type: 'quote_carousel', quotes: [] });
    press('Add quote');
    press('Add quote');
    type('Quote 2', 'Twenty seconds, every time.');
    type('Who said quote 2', 'Ward manager');
    press('Remove quote 1');
    const block = latest();
    expect(block?.type === 'quote_carousel' && block.quotes).toMatchObject([
      { text: 'Twenty seconds, every time.', attribution: 'Ward manager' },
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('edit a table: header row, cells, rows and columns', () => {
    const { latest } = edit({
      id: 'b1',
      type: 'table',
      headerRow: false,
      rows: [['When', 'Why']],
    });
    expect(screen.getByRole('button', { name: 'Remove last row' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'First row is a header' }));
    press('Add row');
    type('Row 2, column 1', 'Before touching a patient');
    press('Add column');
    type('Row 1, column 3', 'Who');
    expect(latest()).toEqual({
      id: 'b1',
      type: 'table',
      headerRow: true,
      rows: [
        ['When', 'Why', 'Who'],
        ['Before touching a patient', '', ''],
      ],
    });
    press('Remove last column');
    press('Remove last row');
    expect(latest()).toMatchObject({ rows: [['When', 'Why']] });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('textbox')).toHaveLength(2);
  });
});
