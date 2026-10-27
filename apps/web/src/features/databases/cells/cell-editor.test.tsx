import type { Property } from '@carehub/databases';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsProperties, PROPS } from '../fixtures';
import { CellEditor } from './cell-editor';
import { CELL_TEXT } from './messages';
import { cellCtx, numberConfig, openEditor, pressOutside, prop, settle } from './test-helpers';

const jobs = jobsProperties();
function job(id: string): Property {
  const found = jobs.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
}
const textbox = (name: string) => screen.getByRole('textbox', { name });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const key = (el: HTMLElement, k: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(el, { key: k, ...init });

describe('CellEditor: text fields', () => {
  it('opens over the cell with the cursor at the end of the value', async () => {
    await openEditor({ property: job(PROPS.name), value: 'Fix kitchen sink leak' });
    expect(screen.getByRole('dialog', { name: 'Name' })).toBeInTheDocument();
    const input = textbox('Name') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe('Fix kitchen sink leak'.length);
  });

  it('saves the Name with Enter', async () => {
    const { onCommit } = await openEditor({
      property: job(PROPS.name),
      value: 'Fix kitchen sink leak',
    });
    type(textbox('Name'), '  Fix the kitchen sink  ');
    key(textbox('Name'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith('Fix the kitchen sink', { changed: true });
  });

  it('saves a cleared Name as "" and says when nothing changed', async () => {
    const cleared = await openEditor({ property: job(PROPS.name), value: 'Fix kitchen sink leak' });
    type(textbox('Name'), '');
    key(textbox('Name'), 'Enter');
    expect(cleared.onCommit).toHaveBeenCalledWith('', { changed: true });
    cleared.unmount();
    const same = await openEditor({ property: job(PROPS.name), value: 'Fix kitchen sink leak' });
    key(textbox('Name'), 'Enter');
    expect(same.onCommit).toHaveBeenCalledWith('Fix kitchen sink leak', { changed: false });
  });

  it('starts from typed text instead of the value', async () => {
    await openEditor({
      property: job(PROPS.name),
      value: 'Fix kitchen sink leak',
      initialText: 'R',
    });
    expect(textbox('Name')).toHaveValue('R');
  });

  it('refuses a Name over 2,000 characters until it is shortened', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.name), value: '' });
    const input = textbox('Name');
    type(input, 'x'.repeat(2_001));
    key(input, 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('Names can be up to 2,000 characters.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Names can be up to 2,000 characters.');
    expect(onCommit).not.toHaveBeenCalled();
    type(input, 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps Text on one more line with Shift+Enter and saves with Enter', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.notes), value: null });
    const area = textbox('Notes');
    type(area, 'Call first');
    key(area, 'Enter', { shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    key(area, 'Enter');
    expect(onCommit).toHaveBeenCalledWith([{ text: 'Call first' }], { changed: true });
  });

  it('keeps marks and mentions when the text wasn’t changed', async () => {
    const rich = [{ text: 'Call ' }, { text: 'first', marks: ['bold' as const] }];
    const { onCommit } = await openEditor({ property: job(PROPS.notes), value: rich });
    expect(textbox('Notes')).toHaveValue('Call first');
    key(textbox('Notes'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(rich, { changed: false });
  });

  it('refuses Text over 10,000 characters', async () => {
    await openEditor({ property: job(PROPS.notes), value: null });
    type(textbox('Notes'), 'x'.repeat(10_001));
    key(textbox('Notes'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('Text can be up to 10,000 characters.');
  });

  it('reads numbers as typed and refuses words', async () => {
    const amount = prop(numberConfig({ format: 'number_commas' }), 'Hours');
    const { onCommit } = await openEditor({ property: amount, value: '2' });
    const input = textbox('Hours');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    type(input, 'abc');
    key(input, 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.');
    type(input, '1,234.50');
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('1234.5', { changed: true });
  });

  it('saves an emptied number as empty', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.cost), value: '180' });
    type(textbox('Cost'), '');
    key(textbox('Cost'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(null, { changed: true });
  });

  it('edits Percent as shown: 0.45 is 45', async () => {
    const share = prop(numberConfig({ format: 'percent' }), 'Share');
    const first = await openEditor({ property: share, value: '0.45' });
    expect(textbox('Share')).toHaveValue('45');
    type(textbox('Share'), '50');
    key(textbox('Share'), 'Enter');
    expect(first.onCommit).toHaveBeenCalledWith('0.5', { changed: true });
    first.unmount();
    const second = await openEditor({ property: share, value: null });
    type(textbox('Share'), '45%');
    key(textbox('Share'), 'Enter');
    expect(second.onCommit).toHaveBeenCalledWith('0.45', { changed: true });
  });

  it('adds https:// to web addresses and refuses ones that aren’t', async () => {
    const site = prop({ type: 'url' }, 'Website');
    const { onCommit } = await openEditor({ property: site, value: null });
    const input = textbox('Website');
    expect(input).toHaveAttribute('inputmode', 'url');
    type(input, 'javascript:alert(1)');
    key(input, 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a web address.');
    type(input, 'example.com');
    key(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('https://example.com', { changed: true });
  });

  it('checks email addresses and phone numbers', async () => {
    const email = await openEditor({ property: prop({ type: 'email' }, 'Email'), value: null });
    type(textbox('Email'), 'avery@');
    key(textbox('Email'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an email address like name@example.com.',
    );
    type(textbox('Email'), 'avery@bluepine.example');
    key(textbox('Email'), 'Enter');
    expect(email.onCommit).toHaveBeenCalledWith('avery@bluepine.example', { changed: true });
    email.unmount();
    const phone = await openEditor({ property: prop({ type: 'phone' }, 'Phone'), value: null });
    expect(textbox('Phone')).toHaveAttribute('inputmode', 'tel');
    type(textbox('Phone'), 'call me');
    key(textbox('Phone'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a phone number.');
    type(textbox('Phone'), '(555) 010-2030');
    key(textbox('Phone'), 'Enter');
    expect(phone.onCommit).toHaveBeenCalledWith('(555) 010-2030', { changed: true });
  });
});

describe('CellEditor: keys and presses', () => {
  it('leaves without saving on Escape', async () => {
    const { onCommit, onCancel } = await openEditor({ property: job(PROPS.name), value: 'Fix' });
    type(textbox('Name'), 'Fix the sink');
    key(textbox('Name'), 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('saves and moves on with Tab and Shift+Tab', async () => {
    const next = await openEditor({ property: job(PROPS.name), value: 'Fix' });
    type(textbox('Name'), 'Fix the sink');
    key(textbox('Name'), 'Tab');
    expect(next.onCommit).toHaveBeenCalledWith('Fix the sink', { changed: true, move: 'next' });
    next.unmount();
    const back = await openEditor({ property: job(PROPS.name), value: 'Fix' });
    key(textbox('Name'), 'Tab', { shiftKey: true });
    expect(back.onCommit).toHaveBeenCalledWith('Fix', { changed: false, move: 'previous' });
  });

  it('stays open on Tab when the value can’t be saved', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.cost), value: null });
    type(textbox('Cost'), 'a lot');
    key(textbox('Cost'), 'Tab');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.');
  });

  it('saves on a press outside, and leaves when the value can’t be saved', async () => {
    const saved = await openEditor({ property: job(PROPS.cost), value: null });
    type(textbox('Cost'), '95');
    pressOutside();
    expect(saved.onCommit).toHaveBeenCalledWith('95', { changed: true });
    saved.unmount();
    const left = await openEditor({ property: job(PROPS.cost), value: null });
    type(textbox('Cost'), 'a lot');
    pressOutside();
    expect(left.onCommit).not.toHaveBeenCalled();
    expect(left.onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps its keys and presses from the table under it', async () => {
    const tableKeys = vi.fn();
    const tableClicks = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- stands in for the table
      <div className="relative" onKeyDown={tableKeys} onClick={tableClicks}>
        <CellEditor
          property={job(PROPS.name)}
          value="Fix"
          ctx={cellCtx()}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );
    await settle();
    key(textbox('Name'), 'ArrowDown');
    key(textbox('Name'), 'Enter');
    fireEvent.click(textbox('Name'));
    expect(tableKeys).not.toHaveBeenCalled();
    expect(tableClicks).not.toHaveBeenCalled();
  });

  it('opens over another element when given one', async () => {
    const cell = document.createElement('div');
    document.body.append(cell);
    await openEditor({ property: job(PROPS.name), value: 'Fix', anchor: cell });
    expect(screen.getByRole('dialog', { name: 'Name' })).toBeInTheDocument();
    cell.remove();
  });
});

describe('CellEditor: checkbox', () => {
  it('ticks with a click or Enter and saves', async () => {
    const clicked = await openEditor({ property: job(PROPS.paid), value: false });
    const box = screen.getByRole('checkbox', { name: 'Paid' });
    expect(box).toHaveFocus();
    fireEvent.click(box);
    expect(clicked.onCommit).toHaveBeenCalledWith(true, { changed: true });
    clicked.unmount();
    const entered = await openEditor({ property: job(PROPS.paid), value: true });
    key(screen.getByRole('checkbox', { name: 'Paid' }), 'Enter');
    expect(entered.onCommit).toHaveBeenCalledWith(false, { changed: true });
  });

  it('moves on with Tab and leaves on a press outside', async () => {
    const { onCommit, onCancel } = await openEditor({ property: job(PROPS.paid), value: true });
    key(screen.getByRole('checkbox', { name: 'Paid' }), 'Tab');
    expect(onCommit).toHaveBeenCalledWith(true, { changed: false, move: 'next' });
    pressOutside();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('CellEditor: read-only types', () => {
  const total = prop(
    { type: 'formula', expression: '1', resultKind: 'number', number: null },
    'Total',
  );

  it('shows the value and says it can’t be edited', async () => {
    await openEditor({ property: total, value: { kind: 'number', value: 42 } });
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText("This property can't be edited.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Total' })).toHaveFocus();
  });

  it('shows a verification, which only the knowledge base changes', async () => {
    await openEditor({ property: prop({ type: 'verification' }, 'Verification'), value: null });
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByText("This property can't be edited.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Verification' })).toHaveFocus();
  });

  it('leaves on Enter and Escape, and passes Tab on', async () => {
    const { onCancel, onCommit } = await openEditor({
      property: prop({ type: 'unique_id', prefix: 'QA' }, 'ID'),
      value: '12',
    });
    const panel = screen.getByRole('dialog', { name: 'ID' });
    key(panel, 'Enter');
    key(panel, 'Escape');
    key(panel, 'Tab');
    expect(onCancel.mock.calls).toEqual([[], [], [{ move: 'next' }]]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('lets a button be pressed', async () => {
    const onPress = vi.fn();
    await openEditor({
      property: prop(
        {
          type: 'button',
          label: 'Mark paid',
          actions: [{ kind: 'open_link', url: 'https://example.com' }],
        },
        'Actions',
      ),
      value: null,
      onPress,
    });
    const press = screen.getByRole('button', { name: 'Mark paid' });
    expect(press).toHaveFocus();
    await act(async () => {
      fireEvent.click(press);
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("This property can't be edited.")).toBeNull();
    expect(screen.queryByText(CELL_TEXT.pressBlocked)).toBeNull();
  });
});
