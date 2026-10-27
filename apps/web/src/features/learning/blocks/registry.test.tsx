import type { Block } from '@carehub/learning';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { blockViews } from './registry';
import { renderBlock } from './test-utils';

describe('block registry', () => {
  it('has a view for every text block and the continue block', () => {
    const types = [
      'heading',
      'paragraph',
      'list',
      'callout',
      'statement',
      'quote',
      'quote_carousel',
      'two_column',
      'divider',
      'code',
      'table',
      'continue',
    ] as const;
    for (const type of types) expect(typeof blockViews[type]).toBe('function');
  });

  it('shows a plain note for a block type without a view yet', () => {
    renderBlock({ id: 'b-new', type: 'hologram' } as unknown as Block);
    expect(screen.getByText("This block can't be shown yet.")).toBeInTheDocument();
  });
});
