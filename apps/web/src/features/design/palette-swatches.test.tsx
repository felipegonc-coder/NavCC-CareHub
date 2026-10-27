import { colorNames, coverNames } from '@carehub/ui';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaletteSwatches } from './palette-swatches';

describe('PaletteSwatches', () => {
  it('shows every picked colour and every cover', () => {
    render(<PaletteSwatches />);
    const tags = within(screen.getByRole('list', { name: 'Colours as tags' })).getAllByRole(
      'listitem',
    );
    expect(tags).toHaveLength(colorNames.length);
    expect(tags[6]).toHaveTextContent('Blue');
    expect(tags[6]).toHaveClass('bg-blue-bg', 'text-blue-text');
    const covers = within(screen.getByRole('list', { name: 'Covers' })).getAllByRole('listitem');
    expect(covers.map((cover: HTMLElement) => cover.textContent)).toEqual(
      coverNames.map((name) => name.charAt(0).toUpperCase() + name.slice(1)),
    );
  });
});
