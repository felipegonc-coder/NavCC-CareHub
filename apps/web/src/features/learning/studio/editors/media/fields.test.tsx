import { richText } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { optionalRichText, optionalText, withOptional } from './fields';
import { moveTo } from './ListControls';

describe('editor fields', () => {
  it('leaves optional fields out when they are empty', () => {
    const block = { id: 'b', title: 'Old', note: 'x' } as {
      id: string;
      title: string;
      note?: string;
    };
    expect(withOptional(block, 'note', undefined)).toEqual({ id: 'b', title: 'Old' });
    expect(withOptional(block, 'note', 'y')).toEqual({ id: 'b', title: 'Old', note: 'y' });
    expect(block.note).toBe('x');
    expect(optionalText('  ')).toBeUndefined();
    expect(optionalText('Hi')).toBe('Hi');
    expect(optionalRichText(richText(' '))).toBeUndefined();
    expect(optionalRichText(richText('Hi'))).toEqual(richText('Hi'));
  });

  it('moves list items', () => {
    expect(moveTo(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveTo(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });
});
