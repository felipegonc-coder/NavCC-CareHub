import { richText, type TabsBlock } from '@carehub/learning';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewProps } from '../media/testing';
import { TabsView } from './TabsView';

const block: TabsBlock = {
  id: 'tabs_1',
  type: 'tabs',
  tabs: [
    { id: 't1', title: 'Day shift', body: richText('Handover at 7:30.') },
    { id: 't2', title: 'Night shift', body: richText('Handover at 19:30.') },
  ],
};

describe('TabsView', () => {
  it('opens the first tab, then the one picked with the pointer or the arrow keys', async () => {
    render(<TabsView {...viewProps(block)} />);
    const day = screen.getByRole('tab', { name: 'Day shift' });
    const night = screen.getByRole('tab', { name: 'Night shift' });
    expect(day).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Handover at 7:30.');

    fireEvent.mouseDown(night);
    expect(night).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Handover at 19:30.');

    night.focus();
    fireEvent.keyDown(night, { key: 'ArrowRight' });
    await waitFor(() => expect(day).toHaveFocus());
    await waitFor(() => expect(day).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Day shift');
  });
});
