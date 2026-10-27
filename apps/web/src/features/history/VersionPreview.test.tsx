import type { HistoryMark, HistoryNode } from '@carehub/extras/history';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VersionPreview, type PreviewPage } from './VersionPreview';

const text = (value: string, marks?: HistoryMark[]): HistoryNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: HistoryNode[]): HistoryNode => ({ type: 'paragraph', content });
const heading = (value: string): HistoryNode => ({
  type: 'heading',
  attrs: { level: 1 },
  content: [text(value)],
});
const page = (title: string, ...content: HistoryNode[]): PreviewPage => ({
  title,
  content: { type: 'doc', content },
});

const before = page(
  'Refund steps',
  heading('Before you start'),
  p(text('Call the member.')),
  p(text('Use the old fax line.')),
);
const after = page(
  'Refund steps',
  heading('Before you start'),
  p(text('Call the member '), text('today', [{ type: 'bold' }]), text('.')),
  {
    type: 'bulletList',
    content: [{ type: 'listItem', content: [p(text('Log the call'))] }],
  },
);

describe('the version preview', () => {
  it('HT-07: draws rich text the editor reads back when pasted', () => {
    const { container } = render(<VersionPreview page={after} previous={null} showChanges />);
    expect(screen.getByRole('heading', { level: 1, name: 'Refund steps' })).toBeInTheDocument();
    expect(container.querySelector('h2[data-level="1"]')).toHaveTextContent('Before you start');
    expect(container.querySelector('strong')).toHaveTextContent('today');
    expect(container.querySelector('ul > li > p')).toHaveTextContent('Log the call');
    expect(container.querySelector('ins, del')).toBeNull();
  });

  it('HT-04: marks added, removed and changed blocks in colour and for screen readers', () => {
    const { container } = render(<VersionPreview page={after} previous={before} showChanges />);
    const added = container.querySelector('ins');
    expect(added).toHaveClass('bg-green-bg');
    expect(added).toHaveTextContent('added today');
    const changed = screen.getByText('Call the member', { exact: false });
    expect(changed.closest('p')).toHaveClass('border-l-2');
    const removed = screen.getByText('Use the old fax line.', { exact: false }).closest('p');
    expect(removed).toHaveClass('line-through', 'select-none');
    expect(removed).toHaveTextContent('removed Use the old fax line.');
    expect(screen.getByText('Log the call', { exact: false })).toHaveTextContent(
      'added Log the call',
    );
  });

  it('hides removed text when Show changes is off', () => {
    const { container } = render(
      <VersionPreview page={after} previous={before} showChanges={false} />,
    );
    expect(screen.queryByText('Use the old fax line.', { exact: false })).not.toBeInTheDocument();
    expect(container.querySelector('ins, del')).toBeNull();
  });

  it('marks a changed title', () => {
    render(<VersionPreview page={page('Refund steps 2026')} previous={before} showChanges />);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Refund steps added 2026');
    expect(screen.getByText('This version is empty.')).toBeInTheDocument();
  });

  it('draws only web, mail, phone and Care Hub links', () => {
    const link = (href: string, label: string) => text(label, [{ type: 'link', attrs: { href } }]);
    render(
      <VersionPreview
        page={page(
          'Links',
          p(link('https://example.test/claims', 'Claims'), link('javascript:alert(1)', 'Bad')),
          p(link('/p/refund-steps', 'Refund steps')),
        )}
        previous={null}
        showChanges={false}
      />,
    );
    expect(screen.getByRole('link', { name: 'Claims' })).toHaveAttribute(
      'href',
      'https://example.test/claims',
    );
    expect(screen.getByRole('link', { name: 'Refund steps' })).toHaveAttribute(
      'href',
      '/p/refund-steps',
    );
    expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument();
    expect(screen.getByText('Bad')).toBeInTheDocument();
  });
});
