import { markdownToBlocks } from '@carehub/extras/claude/markdown';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Preview } from './Preview';

const show = (markdown: string) => render(<Preview blocks={markdownToBlocks(markdown)} />);

describe('Preview', () => {
  it('draws headings under the page title, paragraphs and marks', () => {
    show('# Visit plan\n\nCall **Jordan Diaz** before the _morning_ visit.\n\n### Notes');
    expect(screen.getByRole('heading', { level: 2, name: 'Visit plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Jordan Diaz').tagName).toBe('STRONG');
    expect(screen.getByText('morning').tagName).toBe('EM');
  });

  it('keeps lists, their numbering and to-dos with their state for screen readers', () => {
    show('3. Check the address\n4. Confirm the time\n\n- [x] Book the van\n- [ ] Pack the forms');
    const [numbered, todos] = screen.getAllByRole('list');
    expect(numbered).toHaveAttribute('start', '3');
    expect(within(numbered!).getAllByRole('listitem')).toHaveLength(2);
    expect(within(todos!).getAllByRole('listitem')[0]).toHaveTextContent('Done: Book the van');
    expect(within(todos!).getAllByRole('listitem')[1]).toHaveTextContent('To do: Pack the forms');
  });

  it('shows links as words, not links, and code as text', () => {
    show('See [the guide](https://example.org/guide).\n\n```\n<b>not bold</b>\n```');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('the guide')).toHaveAttribute('class', 'underline');
    expect(screen.getByText('<b>not bold</b>').tagName).toBe('CODE');
  });
});
