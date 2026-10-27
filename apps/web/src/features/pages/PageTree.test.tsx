import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EntryActions } from './actions';
import type { MoveScope } from './move';
import { PageTree } from './PageTree';
import { groupChildren } from './tree';
import type { TreeNode } from './types';

const page = (id: string, parentId: string | null, title: string, more: Partial<TreeNode> = {}) =>
  ({
    id,
    parentId,
    kind: 'page',
    title,
    icon: null,
    position: id,
    hasChildren: false,
    access: 'edit',
    ...more,
  }) satisfies TreeNode as TreeNode;

// Fictional pages: Onboarding > Week one > Day one, an untitled page and a Rota database.
const pages = [
  page('a1', null, 'Onboarding', { icon: { type: 'emoji', emoji: '👋' } }),
  page('a2', 'a1', 'Week one'),
  page('a3', 'a2', 'Day one'),
  page('b1', null, ''),
  page('c1', null, 'Rota', { kind: 'database' }),
];

// Radix menus measure themselves; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const general: MoveScope = { spaceId: 'general', canAddTop: true };

const fakeActions = (): EntryActions => ({
  canCreate: true,
  isFavorite: () => false,
  toggleFavorite: vi.fn(),
  copyLink: vi.fn(),
  rename: vi.fn(),
  trash: vi.fn(),
  create: vi.fn(),
  move: vi.fn(),
  chooseMove: vi.fn(),
});

function Opened() {
  return <p>Opened {useParams().pageId}</p>;
}

interface HarnessProps {
  list?: TreeNode[];
  open?: string[];
  at?: string;
  extra?: (page: TreeNode) => ReactNode;
  actions?: EntryActions;
  moves?: MoveScope;
}

function Harness({ list = pages, open = [], at = '/', extra, actions, moves }: HarnessProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(open));
  const onExpand = (keys: readonly string[], on: boolean) =>
    setExpanded((before) => {
      const next = new Set(before);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  return (
    <MemoryRouter initialEntries={[at]}>
      <PageTree
        label="General"
        byParent={groupChildren(list)}
        scope="s"
        expanded={expanded}
        onExpand={onExpand}
        actions={actions ?? fakeActions()}
        renderExtra={extra}
        moves={moves}
      />
      <Routes>
        <Route path="/p/:pageId" element={<Opened />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PageTree', () => {
  it('shows entries with their icons, levels and "Untitled"', () => {
    render(<Harness />);
    const items = within(screen.getByRole('tree', { name: 'General' })).getAllByRole('treeitem');
    expect(items.map((item) => item.textContent)).toEqual(['👋Onboarding', 'Untitled', 'Rota']);
    expect(items[0]).toHaveAttribute('aria-level', '1');
    expect(items[0]).toHaveAttribute('aria-setsize', '3');
    expect(items[0]).toHaveAttribute('aria-expanded', 'false');
    expect(items[1]).not.toHaveAttribute('aria-expanded');
  });

  it('moves with the arrow keys, Home and End, and opens with Enter', () => {
    render(<Harness />);
    const onboarding = screen.getByRole('treeitem', { name: 'Onboarding' });
    expect(onboarding).toHaveAttribute('tabindex', '0');
    onboarding.focus();
    fireEvent.keyDown(onboarding, { key: 'ArrowRight' });
    expect(onboarding).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(onboarding, { key: 'ArrowRight' });
    const week = screen.getByRole('treeitem', { name: 'Week one' });
    expect(week).toHaveFocus();
    expect(week).toHaveAttribute('aria-level', '2');
    fireEvent.keyDown(week, { key: 'ArrowLeft' });
    expect(onboarding).toHaveFocus();
    fireEvent.keyDown(onboarding, { key: 'ArrowLeft' });
    expect(onboarding).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(onboarding, { key: 'End' });
    const rota = screen.getByRole('treeitem', { name: 'Rota' });
    expect(rota).toHaveFocus();
    fireEvent.keyDown(rota, { key: 'Home' });
    expect(onboarding).toHaveFocus();
    fireEvent.keyDown(onboarding, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Untitled' }), { key: 'Enter' });
    expect(screen.getByText('Opened b1')).toBeInTheDocument();
  });

  it('opens and closes with the arrow button', () => {
    render(<Harness />);
    const onboarding = screen.getByRole('treeitem', { name: 'Onboarding' });
    // The arrow is the first button; screen readers use aria-expanded instead.
    fireEvent.click(within(onboarding).getAllByRole('button', { hidden: true })[0] as HTMLElement);
    expect(screen.getByRole('treeitem', { name: 'Week one' })).toBeInTheDocument();
    expect(onboarding).toHaveFocus();
  });

  it("puts an open entry's sub-pages in a group inside it, for screen readers", () => {
    render(<Harness open={['s:a1']} />);
    const onboarding = screen.getByRole('treeitem', { name: 'Onboarding' });
    expect(onboarding).toHaveAccessibleName('Onboarding');
    const inside = within(onboarding).getByRole('group');
    expect(
      within(inside)
        .getAllByRole('treeitem')
        .map((item) => item.textContent),
    ).toEqual(['Week one']);
  });

  it('shows "No pages inside" for an open page without sub-pages', () => {
    render(<Harness open={['s:b1']} />);
    expect(screen.getByRole('treeitem', { name: 'Untitled' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('No pages inside')).toBeInTheDocument();
  });

  it('shows 50 entries per level, then "Show 20 more"', () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      page(`p${String(i).padStart(2, '0')}`, null, `Shift notes ${i + 1}`),
    );
    render(<Harness list={many} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(screen.getAllByRole('treeitem')).toHaveLength(55);
  });

  it('highlights the open page and opens the entries above it', async () => {
    render(<Harness at="/p/a3" />);
    const day = await screen.findByRole('treeitem', { name: 'Day one' });
    expect(day).toHaveAttribute('aria-current', 'page');
    expect(day).toHaveAttribute('aria-selected', 'true');
    expect(day).toHaveAttribute('tabindex', '0');
  });

  it("mentions a parent the person can't open", () => {
    render(<Harness list={[page('x1', 'hidden', 'Care plan template')]} />);
    expect(
      screen.getByRole('treeitem', { name: 'Care plan template' }),
    ).toHaveAccessibleDescription("In a page you can't open");
  });

  it("shows a database's views under it when it's open", () => {
    render(<Harness open={['s:c1']} extra={(db) => <span>Views of {db.title}</span>} />);
    expect(screen.getByRole('treeitem', { name: 'Rota' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Views of Rota')).toBeInTheDocument();
    expect(screen.queryByText('No pages inside')).not.toBeInTheDocument();
  });

  it('opens the "…" menu with Shift+F10, showing only what the person may do', async () => {
    render(<Harness list={[page('a1', null, 'Onboarding', { access: 'view' })]} />);
    const item = screen.getByRole('treeitem', { name: 'Onboarding' });
    fireEvent.keyDown(item, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((entry) => entry.textContent),
    ).toEqual(['Add to Favorites', 'Copy link', 'Open in new tab']);
    expect(screen.queryByRole('button', { name: /Add a page inside/ })).not.toBeInTheDocument();
  });

  it('offers everything to someone with full access, from a right-click', async () => {
    const actions = fakeActions();
    render(
      <Harness actions={actions} list={[page('a1', null, 'Onboarding', { access: 'full' })]} />,
    );
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Onboarding' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((entry) => entry.textContent),
    ).toEqual([
      'Add a page inside',
      'Add to Favorites',
      'Copy link',
      'RenameF2',
      'Move to',
      'Open in new tab',
      'Move to Trash',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Trash' }));
    expect(actions.trash).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('renames inline with F2: Enter saves and Escape cancels', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Onboarding' }), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: 'Page title' });
    expect(input).toHaveValue('Onboarding');
    fireEvent.change(input, { target: { value: '  Welcome ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.rename).toHaveBeenCalledWith('a1', 'Welcome');
    expect(screen.getByRole('treeitem', { name: 'Onboarding' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Onboarding' }), { key: 'F2' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Page title' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(actions.rename).toHaveBeenCalledTimes(1);
  });

  it('adds a page inside with "+" and opens the entry to show it', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a page inside Onboarding' }));
    expect(actions.create).toHaveBeenCalledWith({ parentId: 'a1' });
    expect(screen.getByRole('treeitem', { name: 'Onboarding' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Add a page inside Rota' })).toBeNull();
  });

  it('moves an entry among its siblings with Ctrl+Shift+↓ and ↑', () => {
    const actions = fakeActions();
    const list = pages.map((entry) => ({ ...entry, access: 'full' as const }));
    render(<Harness actions={actions} list={list} moves={general} />);
    const onboarding = screen.getByRole('treeitem', { name: 'Onboarding' });
    fireEvent.keyDown(onboarding, { key: 'ArrowDown', ctrlKey: true, shiftKey: true });
    expect(actions.move).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), {
      spaceId: 'general',
      parentId: null,
      index: 1,
    });
    fireEvent.keyDown(onboarding, { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
    expect(actions.move).toHaveBeenCalledTimes(1); // already first
  });

  it('moves an entry dropped onto a page inside it', () => {
    const actions = fakeActions();
    const list = pages.map((entry) => ({ ...entry, access: 'full' as const }));
    render(<Harness actions={actions} list={list} moves={general} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const untitled = screen.getByRole('treeitem', { name: 'Untitled' });
    const onboarding = screen.getByRole('treeitem', { name: 'Onboarding' });
    fireEvent.dragStart(untitled, { dataTransfer });
    fireEvent.dragOver(onboarding, { dataTransfer });
    expect(onboarding).toHaveClass('ring-2');
    fireEvent.drop(onboarding, { dataTransfer });
    expect(actions.move).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), {
      spaceId: 'general',
      parentId: 'a1',
    });
    expect(onboarding).toHaveAttribute('aria-expanded', 'true');
    expect(onboarding).not.toHaveClass('ring-2');
    fireEvent.dragEnd(untitled);
  });

  it("doesn't let entries be dragged without Full access, or dropped outside a space", () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    expect(screen.getByRole('treeitem', { name: 'Onboarding' })).toHaveAttribute(
      'draggable',
      'false',
    );
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByRole('treeitem', { name: 'Untitled' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('treeitem', { name: 'Onboarding' }), { dataTransfer });
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(actions.move).not.toHaveBeenCalled();
  });
});
