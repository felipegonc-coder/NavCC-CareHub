import type { TimelineBlock } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderEditor } from '../media/testing';
import { TimelineEditor } from './TimelineEditor';

// Fictional content only.
const block: TimelineBlock = {
  id: 'block_1',
  type: 'timeline',
  items: [{ id: 'e1', label: '08:00', title: 'Handover' }],
};

describe('TimelineEditor', () => {
  it('edits when and what, and adds events without text', () => {
    const { latest } = renderEditor(TimelineEditor, block);
    const event = within(screen.getByRole('group', { name: 'Event 1' }));
    fireEvent.change(event.getByRole('textbox', { name: 'When' }), { target: { value: '07:30' } });
    fireEvent.change(event.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Morning handover' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add an event' }));
    expect(latest().items[0]).toEqual({ id: 'e1', label: '07:30', title: 'Morning handover' });
    expect(latest().items[1]).toMatchObject({ label: '', title: '' });
    expect(latest().items[1]).not.toHaveProperty('body');
  });
});
