import type { EmbedBlock } from '@carehub/learning';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmbedEditor } from './EmbedEditor';
import { renderEditor } from './testing';

// Fictional content only.
const form: EmbedBlock = {
  id: 'block_1',
  type: 'embed',
  url: 'https://docs.google.com/forms/d/e/1FAIpQLSexample/viewform',
  title: 'Feedback form',
};
const link = () => screen.getByRole('textbox', { name: 'Link or embed code' });

describe('EmbedEditor', () => {
  it('keeps a link only once the allow-list takes it, saying why not', () => {
    const { latest, changes } = renderEditor(EmbedEditor, form);
    fireEvent.change(link(), { target: { value: 'https://example.test/page' } });
    expect(link()).toHaveAccessibleDescription(/Pages from example.test can't be embedded/);
    expect(changes).toHaveLength(0);
    fireEvent.change(link(), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    expect(latest().url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('stores the address of a pasted embed code', () => {
    const { latest } = renderEditor(EmbedEditor, form);
    fireEvent.change(link(), {
      target: { value: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>' },
    });
    expect(latest().url).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('sets a height in range for forms and documents, but not videos', () => {
    const { latest } = renderEditor(EmbedEditor, form);
    const height = screen.getByRole('spinbutton', { name: 'Height (pixels)' });
    fireEvent.change(height, { target: { value: '50' } });
    expect(height).toHaveAccessibleDescription(/Use a whole number from 100 to 1,200./);
    fireEvent.change(height, { target: { value: '640' } });
    expect(latest().height).toBe(640);
    fireEvent.change(height, { target: { value: '' } });
    expect(latest()).not.toHaveProperty('height');
    fireEvent.change(link(), { target: { value: 'https://vimeo.com/76979871' } });
    expect(screen.queryByRole('spinbutton', { name: 'Height (pixels)' })).toBeNull();
  });
});
