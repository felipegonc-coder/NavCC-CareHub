import type { FlashcardsBlock } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { picture, renderEditor } from '../media/testing';
import { FlashcardsEditor } from './FlashcardsEditor';

// Fictional content only.
const block: FlashcardsBlock = {
  id: 'block_1',
  type: 'flashcards',
  cards: [{ id: 'c1', front: 'PPE', back: 'Gear', backImage: picture('Gloves') }],
};

describe('FlashcardsEditor', () => {
  it('edits both sides of a card and its pictures', () => {
    const { latest } = renderEditor(FlashcardsEditor, block);
    const card = within(screen.getByRole('group', { name: 'Card 1' }));
    fireEvent.change(card.getByRole('textbox', { name: 'Back' }), {
      target: { value: 'Personal protective equipment' },
    });
    expect(card.getByRole('group', { name: 'Front picture (optional)' })).toBeInTheDocument();
    const back = within(card.getByRole('group', { name: 'Back picture (optional)' }));
    fireEvent.click(back.getByRole('button', { name: 'Remove' }));
    expect(latest().cards[0]).toEqual({
      id: 'c1',
      front: 'PPE',
      back: 'Personal protective equipment',
    });
  });

  it('adds empty cards', () => {
    const { latest } = renderEditor(FlashcardsEditor, block);
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    expect(latest().cards[1]).toMatchObject({ front: '', back: '' });
  });
});
