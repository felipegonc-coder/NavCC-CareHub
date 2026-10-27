import { richText, type Block } from '@carehub/learning';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderBlock } from '../test-utils';

const intro: Block = { id: 'intro', type: 'paragraph', text: richText('Read this first.') };
const steps: Block = {
  id: 'steps',
  type: 'process',
  steps: [{ id: 's1', title: 'Greet', body: richText('Say hello and your name.') }],
};

describe('ContinueView', () => {
  it('records the click', () => {
    const block: Block = { id: 'go-on', type: 'continue', requires: 'click' };
    const { emit } = renderBlock(block, { blocks: [intro, block] });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(emit).toHaveBeenCalledWith({
      type: 'block_completed',
      lessonId: 'lesson-test',
      blockId: 'go-on',
    });
  });

  it('uses its own label', () => {
    renderBlock({ id: 'c', type: 'continue', requires: 'click', label: 'I understand' });
    expect(screen.getByRole('button', { name: 'I understand' })).toBeEnabled();
  });

  it('waits for the activities above it', () => {
    const block: Block = { id: 'gate', type: 'continue', requires: 'complete_above' };
    const { emit } = renderBlock(block, { blocks: [intro, steps, block] });
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Finish the activity above to continue.');
    fireEvent.click(button);
    expect(emit).not.toHaveBeenCalled();
  });

  it('opens when the activities since the previous continue block are done', () => {
    const first: Block = { id: 'first', type: 'continue', requires: 'click' };
    const gate: Block = { id: 'gate', type: 'continue', requires: 'complete_above' };
    renderBlock(gate, { blocks: [steps, first, intro, gate], completed: ['first'] });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('disappears once passed', () => {
    const block: Block = { id: 'c', type: 'continue', requires: 'click' };
    const { container } = renderBlock(block, { completed: ['c'] });
    expect(container).toBeEmptyDOMElement();
  });
});
