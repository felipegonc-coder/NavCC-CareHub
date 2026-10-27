import { describe, expect, it } from 'vitest';
import { printViewSchema } from './api';

const DATABASE = '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9';
const view = { page: { title: 'Week plan', icon: null }, properties: [], blocks: [], pages: {} };

describe('printViewSchema', () => {
  it('reads each inline database as rows, header first, without the formula apostrophe', () => {
    const csv = '\uFEFFClient,Notes\r\nRowan Diaz,"Ring twice,\nthen wait"\r\nSam Ortiz,\'=1+1\r\n';
    const parsed = printViewSchema.parse({
      ...view,
      databases: [{ databaseId: DATABASE, viewId: null, csv }],
    });
    expect(parsed.databases).toEqual([
      {
        databaseId: DATABASE,
        viewId: null,
        rows: [
          ['Client', 'Notes'],
          ['Rowan Diaz', 'Ring twice,\nthen wait'],
          ['Sam Ortiz', '=1+1'],
        ],
      },
    ]);
  });

  it('drops blocks that are not blocks, and takes a view without databases', () => {
    const parsed = printViewSchema.parse({ ...view, blocks: [{ type: 'paragraph' }, 'stray', 4] });
    expect(parsed.blocks).toEqual([{ type: 'paragraph' }]);
    expect(parsed.databases).toEqual([]);
  });
});
