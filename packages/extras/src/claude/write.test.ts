import { describe, expect, it } from 'vitest';
import {
  characterCount,
  needsSelection,
  WRITE_ACTION_LABELS,
  WRITE_ACTIONS,
  WRITE_TONE_LABELS,
  writeAppliedSchema,
  writeRequestSchema,
  writeTooLong,
} from './write';

const pageId = 'f1b0c7de-0000-4000-8000-000000000003';
const issues = (input: unknown) => {
  const parsed = writeRequestSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe('writing help actions', () => {
  it('lists the menu in the order of the spec', () => {
    expect(WRITE_ACTIONS.map((action) => WRITE_ACTION_LABELS[action])).toEqual([
      'Improve writing',
      'Fix grammar',
      'Change tone',
      'Make shorter',
      'Simplify',
      'Continue writing',
      'Summarize',
      'Draft',
    ]);
    expect(Object.values(WRITE_TONE_LABELS)).toEqual([
      'Professional',
      'Friendly',
      'Direct',
      'Empathetic',
    ]);
  });

  it('needs a selection only for rewriting', () => {
    expect(WRITE_ACTIONS.filter(needsSelection)).toEqual([
      'improve',
      'fix_grammar',
      'change_tone',
      'make_shorter',
      'simplify',
    ]);
  });
});

describe('writeRequestSchema', () => {
  it('takes each action with what it needs', () => {
    expect(issues({ pageId, action: 'improve', selection: 'Hi there' })).toEqual([]);
    expect(issues({ pageId, action: 'change_tone', tone: 'friendly', selection: 'Hi' })).toEqual(
      [],
    );
    expect(issues({ pageId, action: 'continue' })).toEqual([]);
    expect(issues({ pageId, action: 'summarize', at: 12 })).toEqual([]);
    expect(issues({ pageId, action: 'draft', prompt: 'A welcome note' })).toEqual([]);
    expect(writeRequestSchema.parse({ pageId, action: 'summarize' }).selection).toBe('');
  });

  it('says what is missing', () => {
    expect(issues({ pageId, action: 'change_tone', selection: 'Hi' })).toEqual(['Pick a tone.']);
    expect(issues({ pageId, action: 'simplify', selection: '  ' })).toEqual([
      'Select some text first.',
    ]);
    expect(issues({ pageId, action: 'draft', prompt: ' ' })).toEqual([
      'Say what Claude should write.',
    ]);
    expect(issues({ pageId: 'page-1', action: 'improve', selection: 'Hi' })).toEqual([
      "That page ID isn't right.",
    ]);
    expect(issues({ pageId, action: 'translate', selection: 'Hi' })).toEqual([
      "That isn't one of the writing help actions.",
    ]);
  });
});

describe('writeTooLong', () => {
  it('allows 10,000 selected characters, counting an emoji as one', () => {
    expect(writeTooLong({ action: 'improve', selection: 'a'.repeat(10_000) })).toBe(false);
    expect(writeTooLong({ action: 'improve', selection: 'a'.repeat(10_001) })).toBe(true);
    expect(writeTooLong({ action: 'improve', selection: '😀'.repeat(10_000) })).toBe(false);
    expect(characterCount('😀a')).toBe(2);
  });

  it('allows any text above the cursor, and 2,000 typed characters for Draft', () => {
    expect(writeTooLong({ action: 'continue', selection: 'a'.repeat(50_000) })).toBe(false);
    expect(writeTooLong({ action: 'draft', selection: '', prompt: 'a'.repeat(2_000) })).toBe(false);
    expect(writeTooLong({ action: 'draft', selection: '', prompt: 'a'.repeat(2_001) })).toBe(true);
  });
});

describe('writeAppliedSchema', () => {
  it('names the page, the action and where the text went', () => {
    const applied = { pageId, action: 'make_shorter', placement: 'insert_below' };
    expect(writeAppliedSchema.parse(applied)).toEqual(applied);
    expect(writeAppliedSchema.safeParse({ ...applied, placement: 'above' }).success).toBe(false);
  });
});
