import { richText, type ProcessBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { picture, viewProps } from '../media/testing';
import { ProcessView } from './ProcessView';

const block: ProcessBlock = {
  id: 'proc_1',
  type: 'process',
  intro: { title: 'Hand rub in six steps', body: richText('It takes 20 seconds.') },
  steps: [
    { id: 's1', title: 'Palm to palm', body: richText('Rub your palms together.') },
    {
      id: 's2',
      title: 'Backs of the hands',
      body: richText('Right palm over the back of the left hand.'),
      image: picture('A right palm over the back of a left hand'),
    },
  ],
  summary: { title: 'Done', body: richText('Let your hands dry.') },
};
const next = (name = 'Next') => fireEvent.click(screen.getByRole('button', { name }));

describe('ProcessView', () => {
  it('goes from the intro through each step to the summary, and is done on the last step', () => {
    const props = viewProps(block);
    render(<ProcessView {...props} />);
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hand rub in six steps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    next('Start');
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Palm to palm' })).toHaveFocus();
    expect(props.emit).not.toHaveBeenCalled();

    next();
    expect(
      screen.getByRole('img', { name: 'A right palm over the back of a left hand' }),
    ).toBeInTheDocument();
    expect(props.emit).toHaveBeenCalledWith({
      type: 'block_completed',
      lessonId: 'lesson_1',
      blockId: 'proc_1',
    });

    next();
    expect(screen.getByRole('heading', { name: 'Done' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(props.emit).toHaveBeenCalledTimes(1);
  });

  it('does not report a block finished before again', () => {
    const props = viewProps(block, {
      state: { lessons: [{ lessonId: 'lesson_1', completedBlockIds: ['proc_1'] }] },
    });
    render(<ProcessView {...props} />);
    next('Start');
    next();
    expect(props.emit).not.toHaveBeenCalled();
  });
});
