import { describe, expect, it } from 'vitest';
import {
  saveTemplateSchema,
  templateIdSchema,
  updateTemplateSchema,
  useTemplateSchema,
} from './schemas';

const pageId = '3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c';

describe('template request bodies', () => {
  it('accept starter keys and UUIDs as template IDs', () => {
    expect(templateIdSchema.safeParse('weekly-huddle').success).toBe(true);
    expect(templateIdSchema.safeParse(pageId).success).toBe(true);
    expect(templateIdSchema.safeParse('Weekly huddle').success).toBe(false);
    expect(templateIdSchema.safeParse('../secrets').success).toBe(false);
  });

  it('trim Save as template fields and include sub-pages by default', () => {
    const saved = saveTemplateSchema.parse({
      pageId,
      name: '  Weekly huddle ',
      category: ' Meetings',
      audience: { type: 'everyone' },
    });
    expect(saved).toEqual({
      pageId,
      name: 'Weekly huddle',
      description: '',
      category: 'Meetings',
      audience: { type: 'everyone' },
      includeSubpages: true,
    });
    const blank = saveTemplateSchema.safeParse({ ...saved, name: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe('Give the template a name.');
    const space = saveTemplateSchema.safeParse({ ...saved, audience: { type: 'space' } });
    expect(space.success).toBe(false);
    const long = saveTemplateSchema.safeParse({ ...saved, description: 'a'.repeat(301) });
    expect(long.error?.issues[0]?.message).toBe('A description can be up to 300 characters.');
  });

  it('need something to change', () => {
    expect(updateTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateTemplateSchema.parse({ name: 'Huddle' })).toEqual({ name: 'Huddle' });
  });

  it('include sample rows unless they are left out', () => {
    expect(useTemplateSchema.parse({ target: { type: 'private' } })).toEqual({
      target: { type: 'private' },
      includeSampleRows: true,
    });
    const apply = { target: { type: 'apply', pageId }, includeSampleRows: false };
    expect(useTemplateSchema.parse(apply)).toEqual(apply);
    expect(useTemplateSchema.safeParse({ target: { type: 'space' } }).success).toBe(false);
  });
});
