import { describe, expect, it } from 'vitest';
import type { ImportItem } from './store';
import { PREVIEW_MAX, keptItems, undoPreview, undoTrash } from './undo';

// What an import made, parents first:
// Intake (page)
//   Forms (page)
//     Consent (page)
//   Visits (database): Monday, Tuesday (rows)
// Contacts (page)
//   Pharmacy (page)
const item = (pageId: string, parentId: string | null, kind: ImportItem['kind'] = 'page') => ({
  pageId,
  parentId,
  kind,
  title: pageId,
});
const items: ImportItem[] = [
  item('Intake', null),
  item('Forms', 'Intake'),
  item('Consent', 'Forms'),
  item('Visits', 'Intake', 'database'),
  item('Monday', 'Visits', 'row'),
  item('Tuesday', 'Visits', 'row'),
  item('Contacts', null),
  item('Pharmacy', 'Contacts'),
];
const titles = (entries: { title: string }[]) => entries.map((entry) => entry.title);

describe('Undo import', () => {
  it('moves the top-most pages to Trash when nothing changed since', () => {
    const none = new Set<string>();
    expect([...keptItems(items, none)]).toEqual([]);
    expect(undoTrash(items, none, false)).toEqual(['Intake', 'Contacts']);
    expect(undoPreview(items, none)).toEqual({
      changed: [],
      unchanged: ['Intake', 'Forms', 'Consent', 'Visits', 'Contacts', 'Pharmacy'].map((id) => ({
        pageId: id,
        title: id,
      })),
    });
  });

  it('keeps a changed page and the pages above it, unless asked not to', () => {
    const changed = new Set(['Consent']);
    expect([...keptItems(items, changed)].sort()).toEqual(['Consent', 'Forms', 'Intake']);
    expect(undoTrash(items, changed, false)).toEqual(['Visits', 'Contacts']);
    const preview = undoPreview(items, changed);
    expect(titles(preview.changed)).toEqual(['Intake', 'Forms', 'Consent']);
    expect(titles(preview.unchanged)).toEqual(['Visits', 'Contacts', 'Pharmacy']);
    expect(undoTrash(items, changed, true)).toEqual(['Intake', 'Contacts']);
  });

  it('keeps a database with all its rows when one row changed', () => {
    const changed = new Set(['Tuesday']);
    expect([...keptItems(items, changed)].sort()).toEqual([
      'Intake',
      'Monday',
      'Tuesday',
      'Visits',
    ]);
    expect(undoTrash(items, changed, false)).toEqual(['Forms', 'Contacts']);
    const preview = undoPreview(items, changed);
    expect(titles(preview.changed)).toEqual(['Intake', 'Visits']);
    expect(titles(preview.unchanged)).toEqual(['Forms', 'Consent', 'Contacts', 'Pharmacy']);
  });

  it('lists at most 1,000 pages in each part of the preview', () => {
    const many = Array.from({ length: PREVIEW_MAX + 5 }, (_, n) => item(`page-${n}`, null));
    const preview = undoPreview(many, new Set(['page-0']));
    expect(preview.changed).toHaveLength(1);
    expect(preview.unchanged).toHaveLength(PREVIEW_MAX);
    expect(undoTrash(many, new Set(['page-0']), false)).toHaveLength(PREVIEW_MAX + 4);
  });
});
