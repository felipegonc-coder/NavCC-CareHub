import type { HocuspocusProvider } from '@hocuspocus/provider';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabEditor, ConnectionNote } from './CollabEditor';
import { PresenceStack } from './PresenceStack';
import type { Person } from './presence';
import type { CollabPage } from './useCollabPage';

// The real editor needs a live provider; these tests are about what's around it.
vi.mock('@carehub/editor', async () => {
  const { createElement } = await import('react');
  return {
    BlockEditor: ({ editable, user }: { editable?: boolean; user?: { name: string } }) =>
      createElement('div', {
        'data-testid': 'editor',
        'data-editable': String(editable),
        'data-user': user?.name,
      }),
  };
});

function pageWith(patch: Partial<CollabPage> = {}): CollabPage {
  return {
    status: 'ready',
    doc: new Y.Doc(),
    provider: {} as HocuspocusProvider,
    generation: 1,
    access: { level: 'edit', readOnly: false, reason: null },
    editable: true,
    live: true,
    reconnecting: false,
    unsent: false,
    notice: null,
    people: [],
    user: { id: 'user-1', name: 'Robin', color: 'blue' },
    dismissNotice: vi.fn(),
    retry: vi.fn(),
    ...patch,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CollabEditor', () => {
  it('shows the editor, with your name for your caret', () => {
    render(<CollabEditor page={pageWith({ editable: false })} />);
    const editor = screen.getByTestId('editor');
    expect(editor).toHaveAttribute('data-editable', 'false');
    expect(editor).toHaveAttribute('data-user', 'Robin');
  });

  it('shows grey lines while the page loads, and says when it waits for the connection', () => {
    vi.useFakeTimers();
    const { container } = render(
      <CollabEditor page={pageWith({ status: 'loading', live: false, reconnecting: true })} />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText('Loading page')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the connection')).toBeInTheDocument();
    expect(container.querySelectorAll('.h-4')).toHaveLength(6);
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it("says when you don't have access", () => {
    render(<CollabEditor page={pageWith({ status: 'no-access' })} />);
    expect(screen.getByText(/have access to this/)).toBeInTheDocument();
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it("offers to try again when the page couldn't open", () => {
    const page = pageWith({ status: 'failed' });
    render(<CollabEditor page={page} />);
    expect(screen.getByText("Couldn't open this page.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(page.retry).toHaveBeenCalledTimes(1);
  });

  it('asks you to reload once Care Hub was updated', () => {
    render(<CollabEditor page={pageWith({ notice: 'outdated', editable: false })} />);
    expect(screen.getByText('Care Hub was updated. Reload to keep editing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('lets you dismiss a notice', () => {
    const page = pageWith({ notice: 'too-long' });
    render(<CollabEditor page={page} />);
    expect(
      screen.getByText('This page is too long. Move some of it into a sub-page.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(page.dismissNotice).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectionNote', () => {
  it('says "Reconnecting…" once the page has been offline a while', () => {
    const { rerender } = render(<ConnectionNote page={pageWith({ live: false })} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    rerender(<ConnectionNote page={pageWith({ live: false, reconnecting: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });
});

describe('PresenceStack', () => {
  const person = (name: string, index: number): Person => ({
    id: `user-${index + 2}`,
    name,
    fullName: `${name} Test`,
    avatarUrl: null,
    color: 'green',
  });

  it('shows five people, then how many more', () => {
    render(<PresenceStack people={['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Flo', 'Gus'].map(person)} />);
    expect(screen.getByRole('list', { name: 'People here now' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Eli Test' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Flo Test' })).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
  });

  it('shows nothing when nobody else is here', () => {
    const { container } = render(<PresenceStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
