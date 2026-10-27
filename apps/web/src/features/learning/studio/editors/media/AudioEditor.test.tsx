import type { AudioBlock } from '@carehub/learning';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AudioEditor } from './AudioEditor';
import { renderEditor } from './testing';

// Fictional content only.
const block: AudioBlock = {
  id: 'block_1',
  type: 'audio',
  media: { kind: 'file', fileId: 'file_1' },
  title: 'Shift handover',
};

describe('AudioEditor', () => {
  it('edits the title, and takes uploads only', () => {
    const { latest } = renderEditor(AudioEditor, block);
    expect(screen.getByText('Plays the uploaded audio file.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Or paste a link' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Night shift handover' },
    });
    expect(latest().title).toBe('Night shift handover');
  });

  it('says why a link cannot play', () => {
    renderEditor(AudioEditor, {
      ...block,
      media: { kind: 'url', url: 'https://example.test/a.mp3' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Care Hub can't play audio from other sites.",
    );
  });
});
