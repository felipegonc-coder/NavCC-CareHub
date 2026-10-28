import { LIMITS, richText, type AccordionBlock, type TabsBlock } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderEditor } from '../media/testing';
import { AccordionEditor, TabsEditor } from './SectionsEditors';

// Fictional content only.
const section = (id: string, title: string) => ({ id, title, body: richText(`About ${title}`) });

describe('AccordionEditor', () => {
  it('edits, adds and removes sections', () => {
    const block: AccordionBlock = {
      id: 'block_1',
      type: 'accordion',
      items: [section('s1', 'Gloves')],
    };
    const { latest } = renderEditor(AccordionEditor, block);
    fireEvent.change(
      within(screen.getByRole('group', { name: 'Section 1' })).getByRole('textbox', {
        name: 'Title',
      }),
      { target: { value: 'Gloves and aprons' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    expect(latest().items).toHaveLength(2);
    expect(latest().items[0]?.title).toBe('Gloves and aprons');
    expect(latest().items[1]).toMatchObject({ title: '', body: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    expect(latest().items.map((item) => item.title)).toEqual(['']);
  });
});

describe('TabsEditor', () => {
  it('stops at the most tabs', () => {
    const tabs = Array.from({ length: LIMITS.tabs }, (_, n) => section(`t${n}`, `Tab ${n}`));
    const block: TabsBlock = { id: 'block_1', type: 'tabs', tabs };
    renderEditor(TabsEditor, block);
    expect(screen.getByRole('button', { name: 'Add a tab' })).toBeDisabled();
    expect(screen.getByText(`This list is full (${LIMITS.tabs} at most).`)).toBeInTheDocument();
  });
});
