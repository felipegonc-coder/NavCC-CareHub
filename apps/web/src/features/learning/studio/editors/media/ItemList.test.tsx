import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ItemList } from './ItemList';

type Row = { id: string; title: string };

function Harness({ start, min }: { start: Row[]; min?: number }) {
  const [items, setItems] = useState(start);
  return (
    <ItemList
      noun="Event"
      items={items}
      max={3}
      min={min}
      newItem={() => ({ id: `new${items.length}`, title: '' })}
      onChange={setItems}
    >
      {(item, update) => (
        <input
          aria-label="Title"
          value={item.title}
          onChange={(event) => update({ title: event.target.value })}
        />
      )}
    </ItemList>
  );
}

const rows = (...titles: string[]) => titles.map((title, n) => ({ id: `r${n}`, title }));
const button = (name: string) => screen.getByRole('button', { name });
const titles = () =>
  screen
    .getAllByRole('textbox', { name: 'Title' })
    .map((box: HTMLElement) => (box as HTMLInputElement).value);

describe('ItemList', () => {
  it('numbers the items and edits them', () => {
    render(<Harness start={rows('Admission', 'Discharge')} />);
    const second = within(screen.getByRole('group', { name: 'Event 2' }));
    fireEvent.change(second.getByRole('textbox', { name: 'Title' }), { target: { value: 'Home' } });
    expect(titles()).toEqual(['Admission', 'Home']);
  });

  it('moves an item, keeping focus on it', () => {
    render(<Harness start={rows('A', 'B', 'C')} />);
    button('Move event 1 down').focus();
    fireEvent.click(button('Move event 1 down'));
    expect(titles()).toEqual(['B', 'A', 'C']);
    expect(button('Move event 2 down')).toHaveFocus();
    fireEvent.click(button('Move event 2 down'));
    expect(titles()).toEqual(['B', 'C', 'A']);
    expect(button('Move event 3 up')).toHaveFocus();
  });

  it('adds an item and focuses it, up to the most allowed', () => {
    render(<Harness start={rows('A', 'B')} />);
    fireEvent.click(button('Add an event'));
    expect(titles()).toEqual(['A', 'B', '']);
    expect(
      within(screen.getByRole('group', { name: 'Event 3' })).getByRole('textbox'),
    ).toHaveFocus();
    expect(button('Add an event')).toBeDisabled();
    expect(screen.getByText('This list is full (3 at most).')).toBeInTheDocument();
  });

  it('removes an item, then focuses Add; never below the least allowed', () => {
    render(<Harness start={rows('A', 'B')} min={1} />);
    fireEvent.click(button('Remove event 1'));
    expect(titles()).toEqual(['B']);
    expect(button('Add an event')).toHaveFocus();
    expect(button('Remove event 1')).toBeDisabled();
  });
});
