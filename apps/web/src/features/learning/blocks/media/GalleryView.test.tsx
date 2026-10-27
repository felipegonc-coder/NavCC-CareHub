import type { GalleryBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GalleryView } from './GalleryView';
import { picture, viewProps } from './testing';

const gallery = (layout: GalleryBlock['layout'], count = 3): GalleryBlock => ({
  id: 'block_1',
  type: 'gallery',
  layout,
  images: Array.from({ length: count }, (_, i) => picture(`Picture ${i + 1}`, `file_${i + 1}`)),
});

describe('GalleryView', () => {
  it('shows every picture in a grid', () => {
    render(<GalleryView {...viewProps(gallery('grid'))} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Picture 3' })).toBeInTheDocument();
  });

  it('shows one picture at a time in a carousel, wrapping around', () => {
    render(<GalleryView {...viewProps(gallery('carousel'))} />);
    expect(screen.getByRole('group', { name: '1 of 3' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Picture 1' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Picture 2' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(screen.getByRole('img', { name: 'Picture 2' })).toBeInTheDocument();
    expect(screen.getByText('Picture 2 of 3')).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    expect(screen.getByRole('img', { name: 'Picture 3' })).toBeInTheDocument();
  });

  it('has no buttons for a single picture, and a note when there are none', () => {
    const { rerender } = render(<GalleryView {...viewProps(gallery('carousel', 1))} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<GalleryView {...viewProps(gallery('carousel', 0))} />);
    expect(screen.getByText('This gallery has no pictures yet.')).toBeInTheDocument();
  });
});
