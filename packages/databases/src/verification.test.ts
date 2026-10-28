import { describe, expect, it } from 'vitest';
import { canChangeProperty } from './access';
import { aggregateValues, aggregatesFor } from './aggregate';
import { itemReader } from './aggregate-maths';
import { canConvert, planConversion } from './convert';
import {
  filterOpLabel,
  filterOpsFor,
  filterValueKind,
  matchesFilter,
  validateFilter,
} from './filter';
import { questionKind } from './forms';
import {
  basicSchema,
  compileFormula,
  propertyType,
  readProperty,
  toStoredFormula,
  type FormulaContext,
} from './formula';
import { canGroupBy } from './group';
import { plainText } from './richtext';
import { readValue } from './row';
import { TYPE_LABELS, defaultConfig, isStoredType } from './schema';
import { filterConditionSchema, propertyConfigSchema } from './schemas';
import { canSortBy, sortRows } from './sort';
import type {
  EvalContext,
  FilterGroup,
  FilterOp,
  Property,
  RichText,
  Row,
  VerificationValue,
  Viewer,
} from './types';
import { formatValue } from './values';
import {
  NOT_WIKI_MESSAGE,
  isVerificationValue,
  verificationState,
  verificationText,
  wikiOnlyProblem,
} from './verification';

// Oct 26, 2026 is a Monday on Mountain Daylight Time (UTC−6): 18:00 UTC is noon in Denver.
const NOW = new Date('2026-10-26T18:00:00.000Z');
const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: NOW,
};

const prop = (id: string, name: string, config: Property['config']): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const title = prop('p-name', 'Name', { type: 'title' });
const verification = prop('p-verified', 'Verification', { type: 'verification' });

const NAMES: Record<string, string> = {
  'u-riley': 'Riley Chen',
  'u-jordan': 'Jordan Park',
  'u-avery': 'Avery Lin',
};
const ctx: EvalContext = {
  properties: [title, verification],
  viewer,
  userName: (id) => NAMES[id],
  isRemovedUser: (id) => id === 'u-jordan',
};

// Stored the way @carehub/extras/knowledge writes them (newVerification, then expired()).
const untilJan20: VerificationValue = {
  state: 'verified',
  verifiedBy: 'u-riley',
  verifiedAt: '2026-10-22T17:00:00.000Z',
  until: '2027-01-20',
};
const expiredOct1: VerificationValue = {
  state: 'expired',
  verifiedBy: 'u-riley',
  verifiedAt: '2026-07-03T17:00:00.000Z',
  until: '2026-10-01',
};
const forever: VerificationValue = {
  state: 'verified',
  verifiedBy: 'u-jordan',
  verifiedAt: '2026-05-01T17:00:00.000Z',
  until: null,
};

const row = (id: string, value?: unknown, createdAt = '2026-10-20T15:00:00.000Z'): Row => ({
  id,
  title: `Refund policy ${id}`,
  values: value === undefined ? {} : { 'p-verified': value },
  createdAt,
  createdBy: 'u-avery',
  editedAt: createdAt,
  editedBy: 'u-avery',
  uniqueNumber: null,
});

describe('verificationState', () => {
  it('is Verified, Expired or Not verified', () => {
    expect(verificationState(untilJan20)).toBe('verified');
    expect(verificationState(expiredOct1)).toBe('expired');
    expect(verificationState(forever)).toBe('verified');
    expect(verificationState(null)).toBe('none');
    expect(verificationState(undefined)).toBe('none');
  });

  it('takes the state as stored: the knowledge base marks it Expired at 9:00 AM (KB-05)', () => {
    // Its until date has passed, but the knowledge base hasn't marked it Expired yet.
    const due = { ...untilJan20, until: '2026-10-26' };
    expect(verificationState(due)).toBe('verified');
    expect(formatValue(verification, due, ctx)).toBe('Verified by Riley Chen until Oct 26, 2026');
    const marked: VerificationValue = { ...due, state: 'expired' };
    expect(verificationState(marked)).toBe('expired');
    expect(formatValue(verification, marked, ctx)).toBe('Verification expired Oct 26, 2026');
  });

  it('reads a time with an offset, as the knowledge base allows', () => {
    const offset = { ...untilJan20, verifiedAt: '2026-10-22T11:00:00-06:00' };
    expect(verificationState(offset)).toBe('verified');
  });

  it('treats a value that is not well formed as Not verified', () => {
    expect(isVerificationValue(untilJan20)).toBe(true);
    expect(isVerificationValue(expiredOct1)).toBe(true);
    expect(isVerificationValue(forever)).toBe(true);
    const broken = [
      { verifiedBy: 'u-riley', verifiedAt: '2026-10-22T17:00:00.000Z', until: '2027-01-20' },
      { ...untilJan20, state: 'pending' },
      { ...expiredOct1, until: null },
      { ...untilJan20, verifiedBy: '' },
      { ...untilJan20, verifiedAt: 'yesterday' },
      { ...untilJan20, verifiedAt: '2026-10-22' },
      { ...untilJan20, until: '2027-13-01' },
      [untilJan20],
      'verified',
      true,
    ];
    for (const value of broken) {
      expect(isVerificationValue(value)).toBe(false);
      expect(verificationState(value)).toBe('none');
    }
  });
});

describe('badge text', () => {
  it('says who verified it and until when', () => {
    expect(verificationText(untilJan20, 'Riley Chen')).toBe(
      'Verified by Riley Chen until Jan 20, 2027',
    );
    expect(verificationText(untilJan20, undefined)).toBe('Verified until Jan 20, 2027');
    expect(verificationText(forever, 'Jordan Park')).toBe('Verified by Jordan Park');
    expect(verificationText(expiredOct1, 'Riley Chen')).toBe('Verification expired Oct 1, 2026');
    expect(verificationText(null, undefined)).toBe('Not verified');
  });

  it('shows in cells and exports through formatValue', () => {
    const show = (value: unknown, forExport = false) =>
      formatValue(verification, readValue(row('r1', value), verification), ctx, { forExport });
    expect(show(untilJan20)).toBe('Verified by Riley Chen until Jan 20, 2027');
    expect(show(expiredOct1)).toBe('Verification expired Oct 1, 2026');
    expect(show(undefined)).toBe('Not verified');
    expect(show(undefined, true)).toBe('Not verified');
    // A removed member keeps their name, marked in cells and plain in exports.
    expect(show(forever)).toBe('Verified by Jordan Park (removed)');
    expect(show(forever, true)).toBe('Verified by Jordan Park');
  });
});

describe('reading values', () => {
  it('reads a stored verification, and anything else as Not verified (null)', () => {
    expect(readValue(row('r1', untilJan20), verification)).toEqual(untilJan20);
    expect(readValue(row('r2'), verification)).toBe(null);
    expect(readValue(row('r3', { verifiedBy: 'u-riley' }), verification)).toBe(null);
  });
});

describe('wiki databases only', () => {
  it('needs a wiki database for a Verification property', () => {
    expect(wikiOnlyProblem('verification', { wiki: true })).toBe(null);
    expect(wikiOnlyProblem('verification', { wiki: false })).toBe(NOT_WIKI_MESSAGE);
    expect(wikiOnlyProblem('verification', {})).toBe(
      'Only knowledge bases can have a Verification property.',
    );
    expect(wikiOnlyProblem('text', {})).toBe(null);
    expect(wikiOnlyProblem('button', { wiki: true })).toBe(null);
  });

  it('is always added as a new property: nothing turns into it', () => {
    for (const from of ['text', 'checkbox', 'date', 'person', 'formula', 'button'] as const) {
      expect(canConvert(from, 'verification')).toBe(false);
    }
    expect(canConvert('verification', 'text')).toBe(true);
    expect(canConvert('verification', 'checkbox')).toBe(false);
  });

  it('turns into Text as shown', () => {
    const rows = [row('r1', untilJan20), row('r2', expiredOct1), row('r3')];
    const plan = planConversion(verification, { type: 'text' }, rows, ctx);
    const texts = rows.map((r) => plainText((plan.values.get(r.id) ?? []) as RichText));
    expect(texts).toEqual([
      'Verified by Riley Chen until Jan 20, 2027',
      'Verification expired Oct 1, 2026',
      'Not verified',
    ]);
    expect(plan.cleared).toBe(0);
  });
});

describe('never typed in', () => {
  it('is never set by hand in a cell, template, button or import', () => {
    expect(isStoredType('verification')).toBe(false);
    expect(canChangeProperty(verification, { userId: 'u-avery' }, 'full')).toBe(false);
  });
});

describe('filters', () => {
  const rows = [
    row('r-verified', untilJan20),
    row('r-expired', expiredOct1),
    row('r-forever', forever),
    row('r-none'),
    row('r-broken', { verifiedBy: 'u-riley' }),
  ];
  const only = (op: FilterOp): string[] => {
    const filter: FilterGroup = {
      kind: 'group',
      id: 'f',
      combinator: 'and',
      children: [{ kind: 'condition', id: 'c1', propertyId: 'p-verified', op }],
    };
    return rows.filter((r) => matchesFilter(r, filter, ctx)).map((r) => r.id);
  };

  it('offers is verified, is expired and is not verified, with no value', () => {
    expect(filterOpsFor(verification)).toEqual(['is_verified', 'is_expired', 'is_not_verified']);
    expect(filterOpsFor(verification).map(filterOpLabel)).toEqual([
      'Is verified',
      'Is expired',
      'Is not verified',
    ]);
    for (const op of filterOpsFor(verification)) {
      expect(filterValueKind(verification, op)).toBe('none');
    }
  });

  it('matches by state', () => {
    expect(only('is_verified')).toEqual(['r-verified', 'r-forever']);
    expect(only('is_expired')).toEqual(['r-expired']);
    expect(only('is_not_verified')).toEqual(['r-none', 'r-broken']);
  });

  it('checks saved filters and request bodies', () => {
    const filter: FilterGroup = {
      kind: 'group',
      id: 'f',
      combinator: 'and',
      children: [{ kind: 'condition', id: 'c1', propertyId: 'p-verified', op: 'is_expired' }],
    };
    expect(validateFilter(filter, [title, verification])).toBe(null);
    const wrong = { ...filter, children: [{ ...filter.children[0], op: 'is_empty' }] };
    expect(validateFilter(wrong as FilterGroup, [title, verification])).not.toBe(null);
    const condition = { kind: 'condition', id: 'c1', propertyId: 'p-verified', op: 'is_verified' };
    expect(filterConditionSchema.safeParse(condition).success).toBe(true);
  });
});

describe('sorting', () => {
  const rows = [
    row('r-none'),
    row('r-expired', expiredOct1),
    row('r-forever', forever),
    row('r-verified', untilJan20),
    row('r-soon', { ...untilJan20, until: '2026-11-02' }),
    row('r-old', { ...expiredOct1, until: '2026-09-01' }),
  ];
  const order = (direction: 'asc' | 'desc') =>
    sortRows(rows, [{ propertyId: 'p-verified', direction }], ctx).map((r) => r.id);

  it('sorts by state, then by the until date (no end date after every date)', () => {
    expect(canSortBy(verification)).toBe(true);
    expect(order('asc')).toEqual([
      'r-soon',
      'r-verified',
      'r-forever',
      'r-old',
      'r-expired',
      'r-none',
    ]);
    expect(order('desc')).toEqual([
      'r-none',
      'r-expired',
      'r-old',
      'r-forever',
      'r-verified',
      'r-soon',
    ]);
  });
});

describe('everything else', () => {
  it('is named Verification and has no settings', () => {
    expect(TYPE_LABELS.verification).toBe('Verification');
    expect(defaultConfig('verification')).toEqual({ type: 'verification' });
    expect(propertyConfigSchema.safeParse({ type: 'verification' }).success).toBe(true);
    const extra = { type: 'verification', period: '90_days' };
    expect(propertyConfigSchema.safeParse(extra).success).toBe(false);
  });

  it('counts its states in totals', () => {
    const read = itemReader(verification, ctx);
    expect(read(untilJan20)).toEqual([{ kind: 'text', value: 'Verified' }]);
    expect(read(null)).toEqual([{ kind: 'text', value: 'Not verified' }]);
    expect(aggregatesFor(verification)).toContain('count_unique');
    expect(aggregatesFor(verification)).not.toContain('sum');
    const values = [untilJan20, expiredOct1, forever, null];
    expect(aggregateValues(values, 'count_unique', verification, ctx)).toEqual({
      kind: 'number',
      value: 3,
    });
    expect(aggregateValues(values, 'count_empty', verification, ctx)).toEqual({
      kind: 'number',
      value: 0,
    });
  });

  it('reads as its state in formulas', () => {
    const fctx: FormulaContext = { ...ctx, page: () => null, userEmail: () => undefined };
    const schema = basicSchema([title, verification]);
    expect(propertyType(verification, schema, 0, () => null)).toEqual({ kind: 'text' });
    expect(readProperty(row('r1', expiredOct1), fctx, verification)).toEqual({
      kind: 'text',
      value: 'Expired',
    });
    const stored = toStoredFormula('prop("Verification") == "Not verified"', schema);
    if (!stored.ok) throw new Error(stored.error.message);
    const compiled = compileFormula(stored.expression, schema);
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(compiled.run(row('r2'), fctx)).toEqual({ kind: 'boolean', value: true });
    expect(compiled.run(row('r3', forever), fctx)).toEqual({ kind: 'boolean', value: false });
  });

  it("can't be grouped by or asked in a form", () => {
    expect(canGroupBy(verification)).toBe(false);
    expect(questionKind(verification)).toBe(null);
  });
});
