import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberExportAllowed, resetExportStore, setExportNavigate } from './export/store';
import { slots } from './slots';

const PAGE_ID = '3f0c2a52-8a7e-4c3e-9d55-6a0f1d9b7c21';
const page = { id: PAGE_ID, kind: 'page' as const, title: 'Support guide' };
const item = (id: string) => slots.pageMenuItems?.find((each) => each.id === id);

afterEach(() => resetExportStore());

describe('import and export slots', () => {
  it('shows Export only once the server says they may export the page (IE-16)', () => {
    const exportItem = item('import-export.export');
    expect(exportItem?.label).toBe('Export');
    expect(exportItem?.isVisible?.(page)).toBe(false);
    rememberExportAllowed(PAGE_ID, true);
    expect(exportItem?.isVisible?.(page)).toBe(true);
    rememberExportAllowed(PAGE_ID, false);
    expect(exportItem?.isVisible?.(page)).toBe(false);
  });

  it('always shows Print, which opens the Print view with the print dialog (IE-16)', () => {
    const print = item('import-export.print');
    expect(print?.label).toBe('Print');
    expect(print?.isVisible).toBeUndefined();
    const navigate = vi.fn();
    setExportNavigate(navigate);
    print?.onSelect(page);
    expect(navigate).toHaveBeenCalledWith(`/p/${PAGE_ID}/print?dialog=1`);
  });

  it('adds the Export dialog to the shell once', () => {
    expect(slots.overlays?.map((overlay) => overlay.id)).toEqual(['import-export.export']);
  });
});
