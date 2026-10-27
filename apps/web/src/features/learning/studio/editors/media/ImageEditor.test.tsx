import { richText, type ImageBlock } from '@carehub/learning';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageEditor } from './ImageEditor';
import { picture, renderEditor } from './testing';

// Fictional content only.
const block: ImageBlock = {
  id: 'block_1',
  type: 'image',
  image: picture('A sink with soap'),
  size: 'medium',
};
const radio = (name: string) => screen.getByRole('radio', { name });

describe('ImageEditor', () => {
  it('edits the picture, which can be replaced but not removed', () => {
    const { latest } = renderEditor(ImageEditor, block);
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alt text' }), {
      target: { value: 'A sink and a soap pump' },
    });
    expect(latest().image.alt).toBe('A sink and a soap pump');
  });

  it('sets the size for the standard layout only', () => {
    const { latest } = renderEditor(ImageEditor, block);
    expect(radio('Standard')).toBeChecked();
    fireEvent.click(radio('Full width'));
    expect(latest().size).toBe('full');
    fireEvent.click(radio('Picture beside text'));
    expect(latest().layout).toBe('image_and_text');
    expect(screen.queryByRole('group', { name: 'Size' })).toBeNull();
  });

  it('has text for every layout but the banner, keeping it', () => {
    const { latest } = renderEditor(ImageEditor, {
      ...block,
      text: richText('Wash for 20 seconds.'),
    });
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    fireEvent.click(radio('Banner'));
    expect(screen.queryByLabelText('Text')).toBeNull();
    expect(latest()).toMatchObject({ layout: 'banner', text: richText('Wash for 20 seconds.') });
  });
});
