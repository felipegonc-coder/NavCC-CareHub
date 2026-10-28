import { richText, type ProcessBlock } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { picture, renderEditor } from '../media/testing';
import { ProcessEditor } from './ProcessEditor';

// Fictional content only.
const block: ProcessBlock = {
  id: 'block_1',
  type: 'process',
  steps: [
    { id: 'p1', title: 'Wet hands', body: richText('Use warm water.'), image: picture('A tap') },
  ],
};
const checkbox = (name: string) => screen.getByRole('checkbox', { name });

describe('ProcessEditor', () => {
  it('turns the introduction on and off, keeping its words', () => {
    const { latest } = renderEditor(ProcessEditor, block);
    expect(screen.queryByRole('textbox', { name: 'Introduction title' })).toBeNull();
    fireEvent.click(checkbox('Start with an introduction'));
    expect(latest().intro).toEqual({ title: '' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Introduction title' }), {
      target: { value: 'Five steps' },
    });
    fireEvent.click(checkbox('Start with an introduction'));
    expect(latest()).not.toHaveProperty('intro');
    fireEvent.click(checkbox('Start with an introduction'));
    expect(latest().intro).toEqual({ title: 'Five steps' });
    expect(checkbox('End with a summary')).not.toBeChecked();
  });

  it('edits steps, whose picture can be removed', () => {
    const { latest } = renderEditor(ProcessEditor, block);
    const step = within(screen.getByRole('group', { name: 'Step 1' }));
    fireEvent.change(step.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Wet your hands' },
    });
    fireEvent.click(step.getByRole('button', { name: 'Remove' }));
    expect(latest().steps[0]).toEqual({
      id: 'p1',
      title: 'Wet your hands',
      body: richText('Use warm water.'),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add a step' }));
    expect(latest().steps[1]).toMatchObject({ title: '', body: [] });
  });
});
