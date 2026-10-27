import { EMBED_ALLOW, EMBED_SANDBOX, richText, type VideoBlock } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VideoView } from './VideoView';
import { viewProps } from './testing';

const video = (patch: Partial<VideoBlock> = {}): VideoBlock => ({
  id: 'block_1',
  type: 'video',
  title: 'Putting on gloves',
  media: { kind: 'file', fileId: 'file_9' },
  ...patch,
});

describe('VideoView', () => {
  it('plays an uploaded video with its captions as tracks', () => {
    const { container } = render(
      <VideoView
        {...viewProps(
          video({
            captions: [
              { fileId: 'vtt_1', language: 'en' },
              { fileId: 'vtt_2', language: 'es-MX', label: 'Español' },
            ],
          }),
        )}
      />,
    );
    const player = container.querySelector('video');
    expect(player).toHaveAttribute('src', '/api/files/file_9');
    expect(player).toHaveAttribute('aria-labelledby', screen.getByText('Putting on gloves').id);
    const tracks = Array.from<HTMLTrackElement>(container.querySelectorAll('track'));
    expect(tracks.map((track) => track.getAttribute('src'))).toEqual([
      '/api/files/vtt_1',
      '/api/files/vtt_2',
    ]);
    expect(tracks.map((track) => track.getAttribute('label'))).toEqual(['English', 'Español']);
    expect(tracks.every((track) => track.getAttribute('kind') === 'captions')).toBe(true);
  });

  it('shows a video site in a sandboxed frame', () => {
    render(
      <VideoView
        {...viewProps(
          video({ media: { kind: 'url', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }),
        )}
      />,
    );
    const frame = screen.getByTitle('Putting on gloves');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(frame).toHaveAttribute('sandbox', EMBED_SANDBOX);
    expect(frame).toHaveAttribute('allow', EMBED_ALLOW);
  });

  it('says why a link can’t be played', () => {
    render(
      <VideoView
        {...viewProps(video({ media: { kind: 'url', url: 'https://example.com/tour' } }))}
      />,
    );
    expect(
      screen.getByText(/^This video can't be played here\. This link isn't a video/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open it in a new tab' })).toHaveAttribute(
      'href',
      'https://example.com/tour',
    );
  });

  it('says so when the video doesn’t load', () => {
    const { container } = render(<VideoView {...viewProps(video())} />);
    const player = container.querySelector('video');
    if (!player) throw new Error('No video.');
    fireEvent.error(player);
    expect(screen.getByText("This video can't be played here.")).toBeInTheDocument();
  });

  it('shows and hides the transcript', () => {
    render(<VideoView {...viewProps(video({ transcript: richText('Wash your hands first.') }))} />);
    const toggle = screen.getByRole('button', { name: 'Show transcript' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Wash your hands first.')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide transcript');
    expect(screen.getByText('Wash your hands first.')).toBeVisible();
  });

  it('has no transcript button without a transcript', () => {
    render(<VideoView {...viewProps(video({ transcript: richText('') }))} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
