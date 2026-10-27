import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { LIMITS } from '../types';
import {
  buttonActionSchema,
  buttonActionsSchema,
  decimalSchema,
  valueEditSchema,
  valueEditsSchema,
} from './buttons';
import { REQUEST_LIMITS } from './common';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

const addRow = { kind: 'add_row', databaseId: 'db-jobs', edits: { title: { set: 'New job' } } };
const openNew = { kind: 'open_page', pageId: null, openIn: 'side_peek' };
const message = {
  kind: 'send_message',
  to: { userIds: ['u-avery'], propertyIds: ['p-owner'] },
  message: 'Jordan Park asked for a callback.',
};

describe('decimalSchema', () => {
  it('takes canonical decimals within the number limits', () => {
    expect(ok(decimalSchema, '12.5')).toBe(true);
    expect(ok(decimalSchema, '-3')).toBe(true);
    expect(ok(decimalSchema, '9'.repeat(LIMITS.numberIntegerDigits))).toBe(true);
    expect(ok(decimalSchema, '9'.repeat(LIMITS.numberIntegerDigits + 1))).toBe(false);
    expect(ok(decimalSchema, `0.${'1'.repeat(LIMITS.numberFractionDigits)}`)).toBe(true);
    expect(ok(decimalSchema, `0.${'1'.repeat(LIMITS.numberFractionDigits + 1)}`)).toBe(false);
  });

  it.each(['12.50', '1e3', '', 'twelve', '1,000', ' 1'])('refuses %j', (s) => {
    expect(ok(decimalSchema, s)).toBe(false);
  });
});

describe('value edits', () => {
  it.each([
    [{ set: 'Blue Pine Plumbing' }],
    [{ set: null }],
    [{ set: ['u-avery'] }],
    [{ formula: 'prop("Hours") * 2' }],
    [{ add: ['u-jordan'] }],
    [{ remove: ['u-avery'] }],
    [{ addNumber: '1.5' }],
  ])('takes %j', (edit) => {
    expect(ok(valueEditSchema, edit)).toBe(true);
  });

  it.each([
    [{}],
    [{ set: undefined }],
    [{ set: 1, formula: 'x' }],
    [{ addNumber: 'lots' }],
    [{ add: 'u-avery' }],
    [{ multiply: '2' }],
    [{ formula: 'x'.repeat(LIMITS.formulaLength + 1) }],
  ])('refuses %j', (edit) => {
    expect(ok(valueEditSchema, edit)).toBe(false);
  });

  it('takes up to 200 edits', () => {
    const edits = (n: number) => Object.fromEntries(ids(n).map((id) => [id, { set: 1 }]));
    expect(ok(valueEditsSchema, edits(LIMITS.properties))).toBe(true);
    expect(ok(valueEditsSchema, edits(LIMITS.properties + 1))).toBe(false);
  });

  it('checks id lists at their limit', () => {
    expect(ok(valueEditSchema, { add: ids(LIMITS.relationLinks) })).toBe(true);
    expect(ok(valueEditSchema, { add: ids(LIMITS.relationLinks + 1) })).toBe(false);
  });
});

describe('buttonActionSchema', () => {
  it.each([
    [{ kind: 'set_values', values: { 'p-done': true } }],
    [{ kind: 'set_values', values: {}, edits: { 'p-hours': { addNumber: '1' } } }],
    [addRow],
    [{ ...addRow, templateId: null, open: 'center_peek' }],
    [{ kind: 'edit_rows', databaseId: 'db-jobs', filter: null, edits: {} }],
    [
      {
        kind: 'edit_rows',
        databaseId: 'db-jobs',
        filter: {
          kind: 'group',
          id: 'g1',
          combinator: 'and',
          children: [{ kind: 'condition', id: 'c1', propertyId: 'p-done', op: 'is_not_checked' }],
        },
        edits: { 'p-done': { set: true } },
      },
    ],
    [{ kind: 'open_page', pageId: 'page-1', openIn: 'new_tab' }],
    [{ kind: 'open_link', url: 'https://bluepine.example/schedule' }],
    [message],
    [
      {
        kind: 'confirm',
        title: 'Close the job?',
        message: 'This tells the client.',
        confirmLabel: 'Close',
      },
    ],
    [{ kind: 'define_variables', variables: [{ id: 'v1', name: 'Total', formula: '1 + 1' }] }],
  ])('takes %j', (action) => {
    expect(ok(buttonActionSchema, action)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<b>hi</b>',
    'vbscript:msgbox(1)',
    ' https://bluepine.example',
    '\thttps://bluepine.example',
    '//bluepine.example',
    'https://user@bluepine.example',
    '/jobs/1',
    `https://bluepine.example/${'x'.repeat(2_000)}`,
  ])('refuses the link %j', (url) => {
    expect(ok(buttonActionSchema, { kind: 'open_link', url })).toBe(false);
  });

  it('sends messages to up to 50 people and 200 properties', () => {
    const to = (userIds: string[], propertyIds: string[]) => ({
      ...message,
      to: { userIds, propertyIds },
    });
    expect(
      ok(buttonActionSchema, to(ids(LIMITS.buttonMessagePeople), ids(LIMITS.properties))),
    ).toBe(true);
    expect(ok(buttonActionSchema, to(ids(LIMITS.buttonMessagePeople + 1), []))).toBe(false);
    expect(ok(buttonActionSchema, to([], ids(LIMITS.properties + 1)))).toBe(false);
  });

  it('takes messages up to 2,000 characters', () => {
    const m = (n: number) => ({ ...message, message: 'x'.repeat(n) });
    expect(ok(buttonActionSchema, m(REQUEST_LIMITS.message))).toBe(true);
    expect(ok(buttonActionSchema, m(REQUEST_LIMITS.message + 1))).toBe(false);
    expect(ok(buttonActionSchema, { ...message, message: 'a\u0000b' })).toBe(false);
  });

  it('checks confirm labels', () => {
    const confirm = { kind: 'confirm', title: 'Sure?', message: '', confirmLabel: 'Yes' };
    expect(ok(buttonActionSchema, { ...confirm, title: 'x'.repeat(REQUEST_LIMITS.label) })).toBe(
      true,
    );
    expect(
      ok(buttonActionSchema, { ...confirm, title: 'x'.repeat(REQUEST_LIMITS.label + 1) }),
    ).toBe(false);
    expect(ok(buttonActionSchema, { ...confirm, confirmLabel: 'a\nb' })).toBe(false);
  });

  it('takes up to 20 variables with different ids and names', () => {
    const vars = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `v${i}`, name: `Var ${i}`, formula: '1' }));
    const define = (variables: unknown) => ({ kind: 'define_variables', variables });
    expect(ok(buttonActionSchema, define(vars(REQUEST_LIMITS.variables)))).toBe(true);
    expect(ok(buttonActionSchema, define(vars(REQUEST_LIMITS.variables + 1)))).toBe(false);
    const [a, b] = vars(2);
    expect(ok(buttonActionSchema, define([a, { ...b, id: 'v0' }]))).toBe(false);
    expect(ok(buttonActionSchema, define([a, { ...b, name: 'VAR 0' }]))).toBe(false);
    expect(
      ok(buttonActionSchema, define([{ ...a, formula: 'x'.repeat(LIMITS.formulaLength) }])),
    ).toBe(true);
  });

  it('refuses unknown kinds and keys', () => {
    expect(ok(buttonActionSchema, { kind: 'run_script', code: 'x' })).toBe(false);
    expect(ok(buttonActionSchema, { ...addRow, priority: 1 })).toBe(false);
    expect(ok(buttonActionSchema, { ...addRow, open: 'new_tab' })).toBe(false);
  });
});

describe('buttonActionsSchema', () => {
  it('takes up to 10 actions', () => {
    const list = (n: number) => Array.from({ length: n }, () => message);
    expect(ok(buttonActionsSchema, list(LIMITS.buttonActions))).toBe(true);
    expect(ok(buttonActionsSchema, list(LIMITS.buttonActions + 1))).toBe(false);
  });

  it('opens a new page only after adding it', () => {
    expect(ok(buttonActionsSchema, [addRow, openNew])).toBe(true);
    expect(ok(buttonActionsSchema, [openNew, addRow])).toBe(false);
    expect(ok(buttonActionsSchema, [openNew])).toBe(false);
    expect(ok(buttonActionsSchema, [{ ...openNew, pageId: 'page-1' }])).toBe(true);
  });
});
