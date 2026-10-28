import { richText, type AudioBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AudioView } from './AudioView';
import { viewProps } from './testing';

const audio = (patch: Partial<AudioBlock> = {}): AudioBlock => ({
  id: 'block_1',
  type: 'audio',
  title: 'Handover call',
  media: { kind: 'file', fileId: 'file_3' },
  transcript: richText('Good morning, team.'),
  ...patch,
});

describe('AudioView', () => {
  it('plays uploaded audio, named by its title, with a transcript', () => {
    const { container } = render(<AudioView {...viewProps(audio())} />);
    const player = container.querySelector('audio');
    expect(player).toHaveAttribute('src', '/api/files/file_3');
    expect(player).toHaveAttribute('aria-labelledby', screen.getByText('Handover call').id);
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }));
    expect(screen.getByText('Good morning, team.')).toBeVisible();
  });

  it('says why a link can’t be played, or that it didn’t load', () => {
    const { container, rerender } = render(
      <AudioView
        {...viewProps(audio({ media: { kind: 'url', url: 'https://example.com/call' } }))}
      />,
    );
    expect(
      screen.getByText(
        /^This audio can't be played here\. Care Hub can't play audio from other sites\./,
      ),
    ).toBeInTheDocument();
    rerender(<AudioView {...viewProps(audio())} />);
    const player = container.querySelector('audio');
    if (!player) throw new Error('No audio.');
    fireEvent.error(player);
    expect(screen.getByText("This audio can't be played here.")).toBeInTheDocument();
  });
});
