import type { ChecklistItem } from '@carehub/databases';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CELL_TEXT } from './messages';
import { openEditor, pressOutside, prop } from './test-helpers';

const steps = prop({ type: 'checklist' }, 'Steps');
const items: ChecklistItem[] = [
  { id: 'item-call', text: 'Call back', done: true },
  { id: 'item-recap', text: 'Send recap', done: false },
];
const addBox = () => screen.getByRole('textbox', { name: CELL_TEXT.addItem });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const enter = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter' });

describe('ChecklistEditor', () => {
  it('ticks items and saves with Enter', async () => {
    const { onCommit } = await openEditor({ property: steps, value: items });
    expect(addBox()).toHaveFocus();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send recap' }));
    enter(addBox());
    expect(onCommit).toHaveBeenCalledWith(
      [items[0], { id: 'item-recap', text: 'Send recap', done: true }],
      { changed: true },
    );
  });

  it('adds what is typed with Enter, then saves with Enter on an empty line', async () => {
    const { onCommit } = await openEditor({ property: steps, value: items, initialText: 'Order' });
    expect(addBox()).toHaveValue('Order');
    type(addBox(), 'Order parts');
    enter(addBox());
    expect(screen.getByRole('textbox', { name: `${CELL_TEXT.item} 3` })).toHaveValue('Order parts');
    expect(addBox()).toHaveValue('');
    expect(onCommit).not.toHaveBeenCalled();
    enter(addBox());
    const [value] = onCommit.mock.calls[0] ?? [];
    expect(value).toHaveLength(3);
    expect(value[2]).toMatchObject({ text: 'Order parts', done: false });
  });

  it('renames and removes items, and drops ones left blank', async () => {
    const { onCommit } = await openEditor({ property: steps, value: items });
    type(screen.getByRole('textbox', { name: `${CELL_TEXT.item} 1` }), '');
    expect(screen.getByRole('checkbox', { name: `${CELL_TEXT.item} 1` })).toBeInTheDocument();
    type(screen.getByRole('textbox', { name: `${CELL_TEXT.item} 2` }), 'Send the recap');
    enter(screen.getByRole('textbox', { name: `${CELL_TEXT.item} 2` }));
    expect(onCommit).toHaveBeenCalledWith(
      [{ id: 'item-recap', text: 'Send the recap', done: false }],
      {
        changed: true,
      },
    );
  });

  it('removes an item with its ✕', async () => {
    const { onCommit } = await openEditor({ property: steps, value: items });
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.remove('Call back') }));
    pressOutside();
    expect(onCommit).toHaveBeenCalledWith([items[1]], { changed: true });
  });

  it('takes up to 100 items of up to 500 characters', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      id: `item-${i}`,
      text: 'Check',
      done: false,
    }));
    const many = await openEditor({ property: steps, value: full });
    type(addBox(), 'One more');
    enter(addBox());
    expect(screen.getByRole('alert')).toHaveTextContent('Up to 100 items.');
    many.unmount();
    const long = await openEditor({ property: steps, value: null });
    type(addBox(), 'x'.repeat(501));
    enter(addBox());
    expect(screen.getByRole('alert')).toHaveTextContent('Items can be up to 500 characters.');
    expect(long.onCommit).not.toHaveBeenCalled();
  });

  it('leaves on Escape, and on a press outside when it can’t be saved', async () => {
    const escaped = await openEditor({ property: steps, value: items });
    fireEvent.keyDown(addBox(), { key: 'Escape' });
    expect(escaped.onCancel).toHaveBeenCalledTimes(1);
    escaped.unmount();
    const long = await openEditor({ property: steps, value: null });
    type(addBox(), 'x'.repeat(501));
    pressOutside();
    expect(long.onCommit).not.toHaveBeenCalled();
    expect(long.onCancel).toHaveBeenCalledTimes(1);
  });

  it('saves and moves on with Tab from the last field', async () => {
    const { onCommit } = await openEditor({ property: steps, value: items });
    fireEvent.keyDown(addBox(), { key: 'Tab' });
    expect(onCommit).toHaveBeenCalledWith(items, { changed: false, move: 'next' });
  });
});
