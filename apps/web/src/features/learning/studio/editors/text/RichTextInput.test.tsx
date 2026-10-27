import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { RichText } from '@carehub/learning';
import { describe, expect, it, vi } from 'vitest';
import { RichTextInput } from './RichTextInput';

const formatted: RichText = [
  { runs: [{ text: 'Wash your hands', marks: ['bold'] }] },
  { runs: [{ text: 'Dry them well.' }] },
];

/** Holds the value like a block editor does, and reports every change. */
function Harness(props: {
  initial: RichText;
  onChange?: (next: RichText) => void;
  singleLine?: boolean;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <>
      <RichTextInput
        value={value}
        ariaLabel="Paragraph text"
        singleLine={props.singleLine ?? false}
        onChange={(next) => {
          setValue(next);
          props.onChange?.(next);
        }}
      />
      <button type="button" onClick={() => setValue(formatted)}>
        Undo
      </button>
    </>
  );
}

describe('RichTextInput (text area stand-in)', () => {
  it('shows the paragraphs with a blank line between them, named by ariaLabel', () => {
    render(<RichTextInput value={formatted} onChange={() => {}} ariaLabel="Paragraph text" />);
    const field = screen.getByRole('textbox', { name: 'Paragraph text' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveValue('Wash your hands\n\nDry them well.');
  });

  it('sends rich text on change and keeps unchanged paragraphs as they were', () => {
    const onChange = vi.fn();
    render(<Harness initial={formatted} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Paragraph text' }), {
      target: { value: 'Wash your hands\n\nDry them with a paper towel.' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as RichText;
    expect(next[0]).toEqual(formatted[0]);
    expect(next[1]).toEqual({ runs: [{ text: 'Dry them with a paper towel.' }] });
  });

  it('keeps a blank line being typed on screen without changing the value', () => {
    const onChange = vi.fn();
    render(<Harness initial={formatted} onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Paragraph text' });
    fireEvent.change(field, { target: { value: 'Wash your hands\n\nDry them well.\n\n' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue('Wash your hands\n\nDry them well.\n\n');
  });

  it('shows a value that changes from outside, such as undo', () => {
    render(<Harness initial={[{ runs: [{ text: 'Draft' }] }]} />);
    const field = screen.getByRole('textbox', { name: 'Paragraph text' });
    fireEvent.change(field, { target: { value: 'Draft two' } });
    expect(field).toHaveValue('Draft two');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(field).toHaveValue('Wash your hands\n\nDry them well.');
  });

  it('is a one-line input with singleLine', () => {
    const onChange = vi.fn();
    render(<Harness initial={[]} onChange={onChange} singleLine />);
    const field = screen.getByRole('textbox', { name: 'Paragraph text' });
    expect(field.tagName).toBe('INPUT');
    fireEvent.change(field, { target: { value: 'Clean hands' } });
    expect(onChange).toHaveBeenCalledWith([{ runs: [{ text: 'Clean hands' }] }]);
  });

  it('passes id, description, placeholder and read-only through', () => {
    render(
      <RichTextInput
        value={[]}
        onChange={() => {}}
        ariaLabel="Callout text"
        id="callout-1"
        ariaDescribedBy="callout-1-hint"
        placeholder="Write something"
        readOnly
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Callout text' });
    expect(field).toHaveAttribute('id', 'callout-1');
    expect(field).toHaveAttribute('aria-describedby', 'callout-1-hint');
    expect(field).toHaveAttribute('placeholder', 'Write something');
    expect(field).toHaveAttribute('readonly');
  });
});
