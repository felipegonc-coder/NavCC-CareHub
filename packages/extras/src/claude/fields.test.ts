import { describe, expect, it } from 'vitest';
import {
  CLAUDE_FIELD_ERRORS,
  claudeFieldFillRequestSchema,
  claudeFieldInputProblem,
  claudeFieldPlanRequestSchema,
  claudeFieldProgressQuerySchema,
  claudeFieldSetupSchema,
  type ClaudeFieldAudience,
  type ClaudeFieldInput,
} from './fields';

const HR: ClaudeFieldAudience = [{ type: 'group', id: 'group-hr' }];
const input = (type: string, see: ClaudeFieldAudience = null): ClaudeFieldInput => ({
  id: `property-${type}`,
  type,
  see,
});

describe('Claude field setup', () => {
  it('starts By hand (CL-D4) and needs something to read', () => {
    const setup = claudeFieldSetupSchema.parse({ kind: 'summary', uses: ['property-notes'] });
    expect(setup).toEqual({
      kind: 'summary',
      instructions: '',
      uses: ['property-notes'],
      usesPageContent: false,
      fill: 'by_hand',
    });
    expect(claudeFieldSetupSchema.safeParse({ kind: 'summary' }).success).toBe(false);
    expect(
      claudeFieldSetupSchema.safeParse({ kind: 'key_points', usesPageContent: true }).success,
    ).toBe(true);
  });

  it('gives Custom fields their own instructions, up to 1,000 characters', () => {
    const custom = { kind: 'custom', uses: ['property-notes'] };
    expect(claudeFieldSetupSchema.safeParse(custom).success).toBe(false);
    const instructions = 'In one sentence: what does the customer want?';
    expect(claudeFieldSetupSchema.parse({ ...custom, instructions }).instructions).toBe(
      instructions,
    );
    const long = { ...custom, instructions: 'x'.repeat(1_001) };
    expect(claudeFieldSetupSchema.safeParse(long).success).toBe(false);
  });
});

describe('claudeFieldInputProblem', () => {
  it('never uses inputs that bring in other rows', () => {
    for (const type of ['relation', 'rollup', 'button', 'claude', 'formula']) {
      expect(claudeFieldInputProblem({ see: null }, [input('text'), input(type)])).toBe(
        'unusable_input',
      );
    }
    const ownRow = { ...input('formula'), readsOtherRows: false };
    expect(claudeFieldInputProblem({ see: null }, [ownRow])).toBeNull();
  });

  it('uses a limited property only when the field is limited to people who can see it', () => {
    const salary = input('number', HR);
    expect(claudeFieldInputProblem({ see: null }, [input('title'), input('text')])).toBeNull();
    expect(claudeFieldInputProblem({ see: null }, [salary])).toBe('hidden_input');
    expect(claudeFieldInputProblem({ see: HR }, [salary])).toBeNull();
    const avery: ClaudeFieldAudience = [{ type: 'user', id: 'user-avery' }];
    expect(claudeFieldInputProblem({ see: avery }, [salary])).toBe('hidden_input');
    expect(claudeFieldInputProblem({ see: [] }, [salary])).toBeNull();
    // The Name is open to everyone who sees the row, whatever its access says.
    expect(claudeFieldInputProblem({ see: null }, [input('title', HR)])).toBeNull();
  });

  it('has plain words for every problem', () => {
    for (const { status, message } of Object.values(CLAUDE_FIELD_ERRORS)) {
      expect([409, 429]).toContain(status);
      expect(message).toMatch(/\.$/);
    }
  });
});

describe('claudeFieldFillRequestSchema', () => {
  const target = {
    databaseId: '4f1c2b9e-7d3a-4c5b-9e8f-1a2b3c4d5e6f',
    propertyId: 'property-summary',
  };
  const row = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  it('takes up to 1,000 row IDs, or all or empty', () => {
    expect(claudeFieldFillRequestSchema.safeParse({ ...target, rowIds: [row] }).success).toBe(true);
    for (const rowIds of ['all', 'empty']) {
      const fill = { ...target, rowIds, confirmedRows: 240 };
      expect(claudeFieldFillRequestSchema.safeParse(fill).success).toBe(true);
    }
    for (const rowIds of [[], Array(1_001).fill(row), ['not-a-row'], 'some']) {
      expect(claudeFieldFillRequestSchema.safeParse({ ...target, rowIds }).success).toBe(false);
    }
  });

  it('takes nothing else', () => {
    const typed = { ...target, rowIds: [row], text: 'Typed by someone.' };
    expect(claudeFieldFillRequestSchema.safeParse(typed).success).toBe(false);
    const plan = { ...target, rowIds: 'all', confirmedRows: 240 };
    expect(claudeFieldPlanRequestSchema.safeParse(plan).success).toBe(false);
    expect(claudeFieldProgressQuerySchema.safeParse(target).success).toBe(true);
    const progress = { ...target, rowIds: 'all' };
    expect(claudeFieldProgressQuerySchema.safeParse(progress).success).toBe(false);
  });
});
