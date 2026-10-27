import { describe, expect, it } from 'vitest';
import { VIEW_BLOCKED } from '@carehub/databases/engine';
import { canEditStructure, cellContext, fileUrl, isBlocked, loadMoreKey } from './contract';
import { jobsDatabase, queryData, testViewer, USERS } from './fixtures';

describe('canEditStructure', () => {
  it('needs Can edit or Full access, with Lock structure off', () => {
    expect(canEditStructure({ viewerAccess: 'full', locked: false })).toBe(true);
    expect(canEditStructure({ viewerAccess: 'edit', locked: false })).toBe(true);
    expect(canEditStructure({ viewerAccess: 'full', locked: true })).toBe(false);
    expect(canEditStructure({ viewerAccess: 'edit_content', locked: false })).toBe(false);
    expect(canEditStructure({ viewerAccess: 'comment', locked: false })).toBe(false);
    expect(canEditStructure({ viewerAccess: 'rows_only', locked: false })).toBe(false);
  });
});

describe('cellContext', () => {
  it("gives cells people's names and photos, related rows' titles and where things open", () => {
    const meta = jobsDatabase();
    const viewer = testViewer();
    const data = queryData(undefined, { rowTitles: { 'row-kitchen': 'Kitchen sink' } });
    const ctx = cellContext(meta, data, viewer);

    expect(ctx.viewer).toBe(viewer);
    expect(ctx.properties).toBe(meta.properties);
    expect(ctx.userName(USERS.jordan.id)).toBe('Jordan Park');
    expect(ctx.userAvatar?.(USERS.jordan.id)).toBe('/api/files/photo-jordan');
    // No photo: the chip shows initials.
    expect(ctx.userAvatar?.(USERS.avery.id)).toBeUndefined();
    expect(ctx.rowTitle?.('row-kitchen')).toBe('Kitchen sink');
    expect(ctx.rowHref?.('row-kitchen')).toBe('/p/row-kitchen');
    const invoice = { id: 'file 7', name: 'invoice.pdf', size: 1200, mime: 'application/pdf' };
    expect(ctx.fileHref?.(invoice)).toBe('/api/files/file%207');
  });

  it('names nobody until the answer has names', () => {
    const ctx = cellContext(jobsDatabase(), { rowTitles: {} }, testViewer());
    expect(ctx.userName(USERS.avery.id)).toBeUndefined();
    expect(ctx.userAvatar?.(USERS.avery.id)).toBeUndefined();
    expect(ctx.rowTitle?.('row-kitchen')).toBeUndefined();
  });
});

describe('fileUrl', () => {
  it('opens uploads through the files API', () => {
    expect(fileUrl({ id: 'photo-jordan' })).toBe('/api/files/photo-jordan');
  });
});

describe('loadMoreKey and isBlocked', () => {
  it('names the view, a group and a sub-group apart', () => {
    expect(loadMoreKey()).toBe('');
    expect(loadMoreKey('g1')).toBe('g1');
    expect(loadMoreKey('g1', 'lane 2')).not.toBe(loadMoreKey('g1'));
    expect(loadMoreKey(undefined, 'lane 2')).toBe(loadMoreKey('', 'lane 2'));
  });

  it('tells a blocked view from rows', () => {
    expect(isBlocked({ blocked: VIEW_BLOCKED })).toBe(true);
    expect(isBlocked(queryData())).toBe(false);
  });
});
