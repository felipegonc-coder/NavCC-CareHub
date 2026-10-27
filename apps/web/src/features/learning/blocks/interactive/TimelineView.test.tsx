import { richText, type TimelineBlock } from '@carehub/learning';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewProps } from '../media/testing';
import { TimelineView } from './TimelineView';

describe('TimelineView', () => {
  it('lists the events in order with their labels', () => {
    const block: TimelineBlock = {
      id: 'tl_1',
      type: 'timeline',
      items: [
        { id: 'e1', label: '07:00', title: 'Handover', body: richText('Read the notes.') },
        { id: 'e2', label: '08:00', title: 'Rounds' },
      ],
    };
    render(<TimelineView {...viewProps(block)} />);
    const events = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(events).toHaveLength(2);
    expect(events[0]).toHaveTextContent('07:00HandoverRead the notes.');
    expect(
      within(events[1] as HTMLElement).getByRole('heading', { name: 'Rounds' }),
    ).toBeInTheDocument();
  });
});
