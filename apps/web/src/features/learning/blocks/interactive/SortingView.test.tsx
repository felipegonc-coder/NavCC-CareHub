import type { SortingBlock } from '@carehub/learning';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewProps } from '../media/testing';
import { SortingView } from './SortingView';

const block: SortingBlock = {
  id: 'sort_1',
  type: 'sorting',
  categories: [
    { id: 'yellow', title: 'Yellow bag' },
    { id: 'black', title: 'Black bag' },
  ],
  items: [
    { id: 'i1', text: 'Used gloves', categoryId: 'yellow' },
    { id: 'i2', text: 'Paper towel', categoryId: 'black' },
  ],
};
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const category = (name: string) =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement;

describe('SortingView', () => {
  it('puts picked items in categories, sends wrong ones back on Check, and is done when all are right', () => {
    const props = viewProps(block);
    render(<SortingView {...props} />);
    expect(screen.getByRole('button', { name: 'Put here: Yellow bag' })).toBeDisabled();

    click('Used gloves');
    expect(screen.getByRole('button', { name: 'Used gloves' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('"Used gloves" picked. Now pick its category.')).toBeInTheDocument();
    click('Put here: Yellow bag');
    click('Paper towel');
    click('Put here: Yellow bag');
    expect(screen.queryByRole('list', { name: 'Items to sort' })).not.toBeInTheDocument();
    expect(within(category('Yellow bag')).getByText('Paper towel')).toBeInTheDocument();

    click('Check');
    expect(
      screen.getByText('1 of 2 right. The others are back in the list: try them again.'),
    ).toBeInTheDocument();
    expect(within(category('Yellow bag')).getByText('Right')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Items to sort' })).getByText('Paper towel'),
    ).toBeInTheDocument();
    expect(props.emit).not.toHaveBeenCalled();

    click('Paper towel');
    click('Put here: Black bag');
    click('Check');
    expect(screen.getByText('Everything is sorted correctly.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    expect(props.emit).toHaveBeenCalledWith({
      type: 'block_completed',
      lessonId: 'lesson_1',
      blockId: 'sort_1',
    });
  });

  it('can put an item back in the list before checking', () => {
    render(<SortingView {...viewProps(block)} />);
    click('Used gloves');
    click('Put here: Black bag');
    click('Put "Used gloves" back in the list');
    expect(
      within(screen.getByRole('list', { name: 'Items to sort' })).getByText('Used gloves'),
    ).toBeInTheDocument();
  });

  it('shows a block finished before as sorted', () => {
    const props = viewProps(block, {
      state: { lessons: [{ lessonId: 'lesson_1', completedBlockIds: ['sort_1'] }] },
    });
    render(<SortingView {...props} />);
    expect(screen.getByText('Everything is sorted correctly.')).toBeInTheDocument();
    expect(within(category('Black bag')).getByText('Paper towel')).toBeInTheDocument();
    expect(props.emit).not.toHaveBeenCalled();
  });
});
