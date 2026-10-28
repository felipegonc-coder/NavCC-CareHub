import { EMBED_FORM_SANDBOX, type EmbedBlock } from '@carehub/learning';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmbedView } from './EmbedView';
import { viewProps } from './testing';

const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSdExample_Form-Id1234/viewform?usp=sf_link';
const embed = (url: string, height?: number): EmbedBlock => ({
  id: 'block_1',
  type: 'embed',
  url,
  title: 'Feedback form',
  ...(height ? { height } : {}),
});

describe('EmbedView', () => {
  it('shows an allowed page in a sandboxed frame at the block’s height', () => {
    render(<EmbedView {...viewProps(embed(FORM, 640))} />);
    const frame = screen.getByTitle('Feedback form');
    expect(frame).toHaveAttribute(
      'src',
      'https://docs.google.com/forms/d/e/1FAIpQLSdExample_Form-Id1234/viewform?embedded=true',
    );
    expect(frame).toHaveAttribute('sandbox', EMBED_FORM_SANDBOX);
    expect(frame).toHaveStyle({ height: '640px' });
    expect(screen.getByRole('link', { name: 'Open in a new tab (Google Forms)' })).toHaveAttribute(
      'href',
      FORM,
    );
  });

  it('never frames a page that isn’t on the allow-list', () => {
    const { container } = render(<EmbedView {...viewProps(embed('https://example.com/page'))} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(
      screen.getByText(/^This can't be shown here\. Pages from example\.com can't be embedded/),
    ).toBeInTheDocument();
  });
});
