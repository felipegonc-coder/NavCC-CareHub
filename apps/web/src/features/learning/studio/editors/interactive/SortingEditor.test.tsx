import type { SortingBlock } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderEditor } from '../media/testing';
import { SortingEditor } from './SortingEditor';

// Fictional content only.
const block: SortingBlock = {
  id: 'block_1',
  type: 'sorting',
  categories: [
    { id: 'k1', title: 'Clinical waste' },
    { id: 'k2', title: 'Recycling' },
  ],
  items: [
    { id: 'i1', text: 'Used gloves', categoryId: 'k1' },
    { id: 'i2', text: 'Cardboard box', categoryId: 'k2' },
  ],
};
const item = (n: number) => within(screen.getByRole('group', { name: `Item ${n}` }));

describe('SortingEditor', () => {
  it('asks for a category before items', () => {
    const { latest } = renderEditor(SortingEditor, { ...block, categories: [], items: [] });
    expect(screen.getByText('Add a category first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));
    const [category] = latest().categories;
    expect(latest().items).toHaveLength(1);
    expect(latest().items[0]).toMatchObject({ text: '', categoryId: category?.id });
  });

  it('edits an item and the category it belongs in', () => {
    const { latest } = renderEditor(SortingEditor, block);
    fireEvent.change(item(2).getByRole('textbox', { name: 'Text' }), {
      target: { value: 'Paper towels' },
    });
    fireEvent.click(item(2).getByRole('button', { name: 'Clinical waste' }));
    expect(latest().items[1]).toEqual({ id: 'i2', text: 'Paper towels', categoryId: 'k1' });
  });

  it('moves the items of a removed category to the first one left', () => {
    const { latest } = renderEditor(SortingEditor, block);
    fireEvent.click(screen.getByRole('button', { name: 'Remove category 1' }));
    expect(latest().categories.map((category) => category.id)).toEqual(['k2']);
    expect(latest().items.map((entry) => entry.categoryId)).toEqual(['k2', 'k2']);
    expect(screen.getByRole('button', { name: 'Remove category 1' })).toBeDisabled();
  });
});
