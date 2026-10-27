import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { defaultConfig, defaultForm, newProperty } from '../schema';
import { LIMITS } from '../types';
import type { FormDefinition, FormQuestion } from '../types';
import { REQUEST_LIMITS } from './common';
import {
  formConditionSchema,
  formDefinitionSchema,
  formDefinitionSchemaFor,
  formLogicSchema,
  formQuestionSchema,
} from './forms';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const name = newProperty('Name', defaultConfig('title'));
const phone = newProperty('Phone', defaultConfig('phone'));
const crew = newProperty('Crew', defaultConfig('person'));
const properties = [name, phone, crew];
const form = defaultForm('Book a visit', properties);
const question = (propertyId: string, logic: FormQuestion['logic'] = null): FormQuestion => ({
  propertyId,
  text: 'Your phone number',
  description: [],
  required: false,
  display: 'default',
  logic,
});
const condition = (questionPropertyId: string, id = 'c1') => ({
  id,
  questionPropertyId,
  op: 'is_not_empty' as const,
});
const withQuestions = (questions: FormQuestion[]): FormDefinition => ({ ...form, questions });

describe('formDefinitionSchema', () => {
  it('takes the default form', () => {
    expect(ok(formDefinitionSchema, form)).toBe(true);
    expect(ok(formDefinitionSchemaFor(properties), form)).toBe(true);
  });

  it('takes all the optional settings', () => {
    const full = {
      ...form,
      audience: 'members_and_guests',
      closeAt: '2025-03-14T16:30:00.000Z',
      maxResponses: 1,
      cover: { id: 'f1', name: 'Van', size: 0, mime: '', url: 'https://bluepine.example/van.jpg' },
      icon: '🔧',
    };
    expect(ok(formDefinitionSchema, full)).toBe(true);
  });

  it('makes anonymous forms take more than one response', () => {
    expect(ok(formDefinitionSchema, { ...form, anonymous: true, allowMultiple: false })).toBe(
      false,
    );
    expect(ok(formDefinitionSchema, { ...form, audience: 'anyone', allowMultiple: false })).toBe(
      false,
    );
    expect(ok(formDefinitionSchema, { ...form, anonymous: true, allowMultiple: true })).toBe(true);
  });

  it('takes up to 100 questions, each property once', () => {
    const questions = (n: number) => Array.from({ length: n }, (_, i) => question(`p${i}`));
    expect(ok(formDefinitionSchema, withQuestions(questions(LIMITS.formQuestions)))).toBe(true);
    expect(ok(formDefinitionSchema, withQuestions(questions(LIMITS.formQuestions + 1)))).toBe(
      false,
    );
    expect(ok(formDefinitionSchema, withQuestions([question('p1'), question('p1')]))).toBe(false);
  });

  it('allows logic only on questions above', () => {
    const logic = (cond: ReturnType<typeof condition>) => ({
      combinator: 'and' as const,
      conditions: [cond],
    });
    const above = [question(name.id), question(phone.id, logic(condition(name.id)))];
    expect(ok(formDefinitionSchema, withQuestions(above))).toBe(true);
    const below = [question(name.id, logic(condition(phone.id))), question(phone.id)];
    expect(ok(formDefinitionSchema, withQuestions(below))).toBe(false);
    const own = [question(name.id), question(phone.id, logic(condition(phone.id)))];
    expect(ok(formDefinitionSchema, withQuestions(own))).toBe(false);
  });

  it('checks the description and confirmation at 2,000 characters', () => {
    const text = (n: number) => [{ text: 'x'.repeat(n) }];
    expect(ok(formDefinitionSchema, { ...form, description: text(LIMITS.formDescription) })).toBe(
      true,
    );
    expect(
      ok(formDefinitionSchema, { ...form, description: text(LIMITS.formDescription + 1) }),
    ).toBe(false);
    expect(
      ok(formDefinitionSchema, { ...form, confirmation: text(LIMITS.formDescription + 1) }),
    ).toBe(false);
  });

  it.each([
    ['a link code with a space', { linkCode: 'abc def' }],
    ['a long link code', { linkCode: 'x'.repeat(65) }],
    ['an empty link code', { linkCode: '' }],
    ['no responses allowed', { maxResponses: 0 }],
    ['a script cover', { cover: { id: 'f1', name: 'x', size: 0, mime: '', url: 'javascript:x' } }],
    ['a script icon', { icon: 'javascript:alert(1)' }],
    ['an unknown audience', { audience: 'public' }],
    ['a bad close date', { closeAt: 'next week' }],
    ['an unknown key', { theme: 'dark' }],
    ['a long submit label', { submitLabel: 'x'.repeat(REQUEST_LIMITS.label + 1) }],
  ])('refuses %s', (_, change) => {
    expect(ok(formDefinitionSchema, { ...form, ...change })).toBe(false);
  });

  it('notifies up to 500 people', () => {
    const people = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    expect(
      ok(formDefinitionSchema, { ...form, notifyUserIds: people(REQUEST_LIMITS.notifyPeople) }),
    ).toBe(true);
    expect(
      ok(formDefinitionSchema, { ...form, notifyUserIds: people(REQUEST_LIMITS.notifyPeople + 1) }),
    ).toBe(false);
  });
});

describe('formDefinitionSchemaFor', () => {
  const anyone: FormDefinition = { ...form, audience: 'anyone' };

  it('refuses Person questions on a form anyone can fill in', () => {
    const withCrew = [question(name.id), question(crew.id)];
    expect(ok(formDefinitionSchemaFor(properties), { ...form, questions: withCrew })).toBe(true);
    expect(ok(formDefinitionSchemaFor(properties), { ...anyone, questions: withCrew })).toBe(false);
    expect(ok(formDefinitionSchema, { ...anyone, questions: withCrew })).toBe(true);
  });

  it('refuses questions on properties that are missing', () => {
    expect(ok(formDefinitionSchemaFor(properties), withQuestions([question('gone')]))).toBe(false);
  });

  it('still checks the shape first', () => {
    expect(ok(formDefinitionSchemaFor(properties), { ...form, linkCode: '' })).toBe(false);
  });
});

describe('questions and logic', () => {
  it('checks question text and descriptions', () => {
    const q = question(phone.id);
    expect(ok(formQuestionSchema, { ...q, text: 'x'.repeat(LIMITS.title) })).toBe(true);
    expect(ok(formQuestionSchema, { ...q, text: 'x'.repeat(LIMITS.title + 1) })).toBe(false);
    const described = (n: number) => ({ ...q, description: [{ text: 'x'.repeat(n) }] });
    expect(ok(formQuestionSchema, described(LIMITS.formDescription))).toBe(true);
    expect(ok(formQuestionSchema, described(LIMITS.formDescription + 1))).toBe(false);
    expect(ok(formQuestionSchema, { ...q, display: 'slider' })).toBe(false);
  });

  it('takes up to 10 conditions, each once', () => {
    const conditions = (n: number) =>
      Array.from({ length: n }, (_, i) => condition(name.id, `c${i}`));
    expect(
      ok(formLogicSchema, { combinator: 'or', conditions: conditions(LIMITS.formConditions) }),
    ).toBe(true);
    expect(
      ok(formLogicSchema, { combinator: 'or', conditions: conditions(LIMITS.formConditions + 1) }),
    ).toBe(false);
    expect(
      ok(formLogicSchema, { combinator: 'or', conditions: [condition('a'), condition('b')] }),
    ).toBe(false);
  });

  it('checks condition operators and values', () => {
    const c = { id: 'c1', questionPropertyId: 'p1', op: 'is_any_of', value: ['o1'] };
    expect(ok(formConditionSchema, c)).toBe(true);
    expect(ok(formConditionSchema, { ...c, op: 'is', value: 'x'.repeat(LIMITS.text) })).toBe(true);
    expect(ok(formConditionSchema, { ...c, op: 'is', value: 'x'.repeat(LIMITS.text + 1) })).toBe(
      false,
    );
    expect(ok(formConditionSchema, { ...c, op: 'within' })).toBe(false);
    expect(ok(formConditionSchema, { ...c, value: 5 })).toBe(false);
  });
});
