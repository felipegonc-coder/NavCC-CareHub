import { LIMITS, richText, type LabeledGraphicBlock } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LabeledGraphicEditor } from './LabeledGraphicEditor';
import { picture, renderEditor } from './testing';

// Fictional content only.
const spot = (id: string, title: string) => ({ id, x: 10, y: 20, title, text: richText('') });
const block: LabeledGraphicBlock = {
  id: 'block_1',
  type: 'labeled_graphic',
  image: picture('A patient room'),
  markers: [spot('m1', 'Call button'), spot('m2', 'Sink')],
};
const titles = (graphic: LabeledGraphicBlock) => graphic.markers.map((marker) => marker.title);
const inSpot = (n: number) => within(screen.getByRole('group', { name: `Spot ${n}` }));

describe('LabeledGraphicEditor', () => {
  it('edits a spot title and where it is, kept within the picture', () => {
    const { latest } = renderEditor(LabeledGraphicEditor, block);
    fireEvent.change(inSpot(2).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Hand sink' },
    });
    fireEvent.change(inSpot(2).getByRole('spinbutton', { name: 'From the left (%)' }), {
      target: { value: '35.5' },
    });
    fireEvent.change(inSpot(2).getByRole('spinbutton', { name: 'From the top (%)' }), {
      target: { value: '140' },
    });
    expect(latest().markers[1]).toMatchObject({ title: 'Hand sink', x: 35.5, y: 100 });
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('adds spots in the middle, and moves and removes them', () => {
    const { latest } = renderEditor(LabeledGraphicEditor, block);
    fireEvent.click(screen.getByRole('button', { name: 'Add a spot' }));
    expect(latest().markers[2]).toMatchObject({ x: 50, y: 50, title: '', text: [] });
    expect(latest().markers[2]?.id).toMatch(/^[A-Za-z0-9]{16}$/);
    fireEvent.click(screen.getByRole('button', { name: 'Move spot 2 up' }));
    expect(titles(latest())).toEqual(['Sink', 'Call button', '']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove spot 3' }));
    expect(titles(latest())).toEqual(['Sink', 'Call button']);
  });

  it('stops adding spots at the limit', () => {
    const markers = Array.from({ length: LIMITS.markers }, (_, n) => spot(`m${n}`, `Spot ${n}`));
    renderEditor(LabeledGraphicEditor, { ...block, markers });
    expect(screen.getByRole('button', { name: 'Add a spot' })).toBeDisabled();
    expect(screen.getByText('This list is full (20 at most).')).toBeInTheDocument();
  });
});
