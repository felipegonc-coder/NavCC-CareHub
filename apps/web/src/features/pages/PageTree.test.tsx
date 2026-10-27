import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { describe, expect, it } from 'vitest';
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

function Opened() {
  return <p>Opened {useParams().pageId}</p>;
}

interface HarnessProps {
  list?: TreeNode[];
  open?: string[];
  at?: string;
  extra?: (page: TreeNode) => ReactNode;
}

function Harness({ list = pages, open = [], at = '/', extra }: HarnessProps) {
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
        renderExtra={extra}
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
    fireEvent.click(within(onboarding).getByRole('button', { hidden: true }));
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
});
