import { richText, type LabeledGraphicBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LabeledGraphicView } from './LabeledGraphicView';
import { picture, viewProps } from './testing';

const block: LabeledGraphicBlock = {
  id: 'block_1',
  type: 'labeled_graphic',
  image: picture('Patient room'),
  markers: [
    { id: 'm1', x: 20, y: 30, title: 'Sink', text: richText('Wash here first.') },
    { id: 'm2', x: 75, y: 60, title: 'Bed rail', text: richText('Wipe it daily.') },
  ],
};

describe('LabeledGraphicView', () => {
  it('puts numbered spots on the picture, in order', () => {
    render(<LabeledGraphicView {...viewProps(block)} />);
    const spots = screen.getAllByRole('button');
    expect(spots.map((spot: HTMLElement) => spot.textContent)).toEqual(['1: Sink', '2: Bed rail']);
    expect(spots[1]).toHaveStyle({ left: '75%', top: '60%' });
    expect(spots[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a spot’s note, switches to another and closes it', () => {
    render(<LabeledGraphicView {...viewProps(block)} />);
    const sink = screen.getByRole('button', { name: '1: Sink' });
    fireEvent.click(sink);
    expect(sink).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: '1: Sink' })).toHaveTextContent('Wash here first.');

    fireEvent.click(screen.getByRole('button', { name: '2: Bed rail' }));
    expect(screen.getByRole('region', { name: '2: Bed rail' })).toHaveTextContent('Wipe it daily.');
    expect(sink).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Close the note' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2: Bed rail' })).toHaveFocus();
  });
});
