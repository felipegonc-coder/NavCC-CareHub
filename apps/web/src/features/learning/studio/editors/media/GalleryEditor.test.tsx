import { LIMITS, type GalleryBlock } from '@carehub/learning';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeRequests, fileInput, pngFile, sent } from '../../../media/testing';
import { GalleryEditor } from './GalleryEditor';
import { picture, renderEditor } from './testing';

// Fictional content only.
const block: GalleryBlock = {
  id: 'block_1',
  type: 'gallery',
  layout: 'grid',
  images: [picture('Gloves', 'file_1'), picture('Apron', 'file_2')],
};
const alts = (gallery: GalleryBlock) => gallery.images.map((image) => image.alt);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

let restore = () => {};
beforeEach(() => {
  restore = fakeRequests();
});
afterEach(() => restore());

describe('GalleryEditor', () => {
  it('sets the layout', () => {
    const { latest } = renderEditor(GalleryEditor, block);
    fireEvent.click(screen.getByRole('radio', { name: 'Carousel, one at a time' }));
    expect(latest().layout).toBe('carousel');
  });

  it('edits, moves and removes pictures', () => {
    const { latest } = renderEditor(GalleryEditor, block);
    expect(screen.getByRole('group', { name: 'Picture 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move picture 1 up' })).toBeDisabled();
    click('Move picture 1 down');
    expect(alts(latest())).toEqual(['Apron', 'Gloves']);
    click('Remove picture 1');
    expect(alts(latest())).toEqual(['Gloves']);
  });

  it('adds an uploaded picture at the end, without alt text yet', async () => {
    const { container, latest } = renderEditor(GalleryEditor, block);
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(1); // the pictures have theirs only when replacing
    fireEvent.change(fileInput(container), { target: { files: [pngFile('Mask.png', 40, 30)] } });
    await waitFor(() => expect(sent().url).toBe('/api/files?scope=learning%3Acourse_1'));
    act(() =>
      sent().answer(201, {
        id: 'file_3',
        name: 'Mask.png',
        size: 33,
        mimeType: 'image/png',
        url: '/api/files/file_3',
      }),
    );
    await waitFor(() => expect(latest().images).toHaveLength(3));
    expect(latest().images[2]).toEqual({ media: { kind: 'file', fileId: 'file_3' }, alt: '' });
  });

  it('says when the gallery is full', () => {
    const images = Array.from({ length: LIMITS.galleryImages }, (_, n) =>
      picture(`P${n}`, `f${n}`),
    );
    renderEditor(GalleryEditor, { ...block, images });
    expect(screen.queryByRole('button', { name: 'Add a picture' })).toBeNull();
    expect(screen.getByText('This gallery is full (20 pictures at most).')).toBeInTheDocument();
  });
});
