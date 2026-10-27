import { richText, type ImageBlock } from '@carehub/learning';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageView } from './ImageView';
import { picture, viewProps } from './testing';

const block = (patch: Partial<ImageBlock> = {}): ImageBlock => ({
  id: 'block_1',
  type: 'image',
  image: picture('Hand washing steps'),
  size: 'medium',
  ...patch,
});

describe('ImageView', () => {
  it('shows a standard picture at its size', () => {
    render(<ImageView {...viewProps(block({ size: 'small' }))} />);
    const figure = screen.getByRole('img', { name: 'Hand washing steps' }).closest('figure');
    expect(figure?.className).toContain('max-w-xs');
  });

  it.each(['image_and_text', 'text_on_image'] as const)(
    'shows the text with layout %s',
    (layout) => {
      render(
        <ImageView {...viewProps(block({ layout, text: richText('Rub for 20 seconds.') }))} />,
      );
      expect(screen.getByRole('img', { name: 'Hand washing steps' })).toBeInTheDocument();
      expect(screen.getByText('Rub for 20 seconds.')).toBeInTheDocument();
    },
  );

  it('shows a banner across the page, without text', () => {
    render(<ImageView {...viewProps(block({ layout: 'banner', text: richText('Hidden') }))} />);
    expect(screen.getByRole('img', { name: 'Hand washing steps' }).className).toContain(
      'object-cover',
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });
});
