import type { FlashcardsBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewProps } from '../media/testing';
import { FlashcardsView } from './FlashcardsView';

const block: FlashcardsBlock = {
  id: 'cards_1',
  type: 'flashcards',
  cards: [
    { id: 'c1', front: 'MRSA', back: 'A bacterium resistant to many antibiotics.' },
    { id: 'c2', front: 'PPE', back: 'Personal protective equipment.' },
  ],
};
const turn = (n: number) =>
  fireEvent.click(screen.getByRole('button', { name: `Turn over card ${n}` }));

describe('FlashcardsView', () => {
  it('turns cards over and is done once every card has been seen', () => {
    const props = viewProps(block);
    render(<FlashcardsView {...props} />);
    expect(screen.getByText('MRSA')).toBeInTheDocument();
    expect(screen.getByText('0 of 2 cards turned over.')).toBeInTheDocument();

    turn(1);
    expect(screen.getByText('A bacterium resistant to many antibiotics.')).toBeInTheDocument();
    expect(screen.queryByText('MRSA')).not.toBeInTheDocument();
    turn(1);
    expect(screen.getByText('MRSA')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 cards turned over.')).toBeInTheDocument();
    expect(props.emit).not.toHaveBeenCalled();

    turn(2);
    expect(screen.getByText("You've turned over every card.")).toBeInTheDocument();
    expect(props.emit).toHaveBeenCalledWith({
      type: 'block_completed',
      lessonId: 'lesson_1',
      blockId: 'cards_1',
    });
    turn(2);
    expect(props.emit).toHaveBeenCalledTimes(1);
  });

  it('shows a block finished before as done', () => {
    const props = viewProps(block, {
      completed: ['cards_1'],
    });
    render(<FlashcardsView {...props} />);
    expect(screen.getByText("You've turned over every card.")).toBeInTheDocument();
    expect(props.emit).not.toHaveBeenCalled();
  });
});
