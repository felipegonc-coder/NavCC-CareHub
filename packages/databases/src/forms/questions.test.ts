import { describe, expect, it } from 'vitest';
import { defaultConfig, defaultForm } from '../schema';
import type {
  FormCondition,
  FormConditionOp,
  FormDefinition,
  FormQuestion,
  Property,
  PropertyConfig,
  SelectOption,
} from '../types';
import {
  FORM_CHOICE_LIMIT,
  addableProperties,
  anonymityWarning,
  conditionOpLabel,
  conditionOps,
  conditionProblem,
  formAudience,
  isAnonymousForm,
  isConditionSet,
  questionKind,
  questionLabel,
  validateFormDefinition,
} from './questions';

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const options = (...names: string[]): SelectOption[] =>
  names.map((n) => ({ id: `opt-${n.toLowerCase()}`, name: n, color: 'default' }));

const name = prop('name', 'Name', { type: 'title' });
const category = prop('category', 'Category', {
  type: 'select',
  options: options('Billing', 'Coaching', 'Other'),
});
const reason = prop('reason', 'Reason', { type: 'text' });
const score = prop('score', 'Score', defaultConfig('number'));
const tags = prop('tags', 'Tags', {
  type: 'multi_select',
  options: options('Calls', 'Chats', 'Emails'),
});
const callDate = prop('call-date', 'Call date', defaultConfig('date'));
const confirm = prop('confirm', 'I confirm', { type: 'checkbox' });
const link = prop('link', 'Recording', { type: 'url' });
const email = prop('email', 'Email', { type: 'email' });
const phone = prop('phone', 'Phone', { type: 'phone' });
const agent = prop('agent', 'Agent', { type: 'person', single: true, notify: true });
const files = prop('files', 'Attachments', { type: 'files' });
const review = prop('review', 'Review', {
  type: 'relation',
  targetDatabaseId: 'db-reviews',
  single: true,
  twoWayPropertyId: null,
});
const stage = prop('stage', 'Stage', defaultConfig('status'));
const notAskable = [
  stage,
  prop('steps', 'Steps', { type: 'checklist' }),
  prop('created', 'Created', defaultConfig('created_time')),
  prop('edited', 'Edited', defaultConfig('edited_time')),
  prop('created-by', 'Created by', { type: 'created_by' }),
  prop('edited-by', 'Edited by', { type: 'edited_by' }),
  prop('uid', 'ID', { type: 'unique_id', prefix: 'QA' }),
  prop('total', 'Total', defaultConfig('formula')),
  prop('hours', 'Hours', {
    type: 'rollup',
    relationPropertyId: 'review',
    targetPropertyId: 'x',
    aggregate: 'sum',
    number: null,
  }),
  prop('button', 'Button', defaultConfig('button')),
];
const askable = [name, category, reason, score, tags, callDate, confirm, link, email, phone];
const properties = [...askable, agent, files, review, ...notAskable];

const q = (p: Property, over: Partial<FormQuestion> = {}): FormQuestion => ({
  propertyId: p.id,
  text: p.name,
  description: [],
  required: false,
  display: 'default',
  logic: null,
  ...over,
});
const when = (source: Property, op: FormConditionOp, value?: string | string[]): FormCondition => ({
  id: `c-${source.id}-${op}`,
  questionPropertyId: source.id,
  op,
  ...(value === undefined ? {} : { value }),
});
const showIf = (...conditions: FormCondition[]): Pick<FormQuestion, 'logic'> => ({
  logic: { combinator: 'and', conditions },
});
const form = (questions: FormQuestion[], over: Partial<FormDefinition> = {}): FormDefinition => ({
  ...defaultForm('QA dispute request', []),
  questions,
  ...over,
});
const long = (n: number) => [{ text: 'x'.repeat(n) }];

describe('questionKind', () => {
  it('shows each property type as the Forms spec says', () => {
    const kinds = Object.fromEntries(
      [...askable, agent, files, review].map((p) => [p.name, questionKind(p)]),
    );
    expect(kinds).toEqual({
      Name: 'short',
      Category: 'radio',
      Reason: 'short',
      Score: 'number',
      Tags: 'checkboxes',
      'Call date': 'date',
      'I confirm': 'checkbox',
      Recording: 'link',
      Email: 'email',
      Phone: 'phone',
      Agent: 'person',
      Attachments: 'files',
      Review: 'relation',
    });
  });
  it('never offers Status, Checklist, created and edited properties, ID, formulas, rollups or buttons', () => {
    expect(notAskable.map((p) => questionKind(p))).toEqual(notAskable.map(() => null));
  });
  it('uses Long answer for Name and Text when set', () => {
    expect(questionKind(reason, { display: 'long' })).toBe('long');
    expect(questionKind(name, { display: 'long' })).toBe('long');
    expect(questionKind(score, { display: 'long' })).toBe('number');
  });
  it('lists up to 7 options as radio buttons or tick boxes, then uses a dropdown', () => {
    const seven = options('A', 'B', 'C', 'D', 'E', 'F', 'G');
    const eight = options('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H');
    expect(FORM_CHOICE_LIMIT).toBe(7);
    expect(questionKind(prop('s', 'S', { type: 'select', options: seven }))).toBe('radio');
    expect(questionKind(prop('s', 'S', { type: 'select', options: eight }))).toBe('dropdown');
    expect(questionKind(prop('m', 'M', { type: 'multi_select', options: seven }))).toBe(
      'checkboxes',
    );
    expect(questionKind(prop('m', 'M', { type: 'multi_select', options: eight }))).toBe(
      'multi_dropdown',
    );
  });
  it('can always use a dropdown', () => {
    expect(questionKind(category, { display: 'dropdown' })).toBe('dropdown');
    expect(questionKind(tags, { display: 'dropdown' })).toBe('multi_dropdown');
  });
  it('leaves Person and Relation out of forms anyone can fill in, and keeps Files', () => {
    const anyone = { audience: 'anyone' } as const;
    expect(questionKind(agent, null, anyone)).toBeNull();
    expect(questionKind(review, null, anyone)).toBeNull();
    expect(questionKind(files, null, anyone)).toBe('files');
    expect(questionKind(reason, null, anyone)).toBe('short');
    expect(questionKind(agent, null, { audience: 'members_and_guests' })).toBe('person');
    expect(questionKind(review, null, { audience: 'members' })).toBe('relation');
  });
});

describe('addableProperties', () => {
  it('offers properties not asked yet that can be questions, in database order', () => {
    const def = form([q(name), q(category)]);
    expect(addableProperties(def, properties).map((p) => p.id)).toEqual([
      'reason',
      'score',
      'tags',
      'call-date',
      'confirm',
      'link',
      'email',
      'phone',
      'agent',
      'files',
      'review',
    ]);
  });
  it('offers Files in anonymous forms, and no Person or Relation when anyone can respond', () => {
    const ids = (def: FormDefinition, audience?: 'anyone' | 'members') =>
      addableProperties(def, properties, audience).map((p) => p.id);
    expect(ids(form([], { anonymous: true }))).toEqual(expect.arrayContaining(['files', 'agent']));
    const anyone = form([], { audience: 'anyone' });
    expect(ids(anyone)).toContain('files');
    expect(ids(anyone)).not.toContain('agent');
    expect(ids(anyone)).not.toContain('review');
    expect(ids(anyone, 'members')).toContain('agent');
    expect(ids(form([]), 'anyone')).not.toContain('review');
  });
});

describe('who can respond', () => {
  it('defaults to members, and forms anyone can fill in are always anonymous', () => {
    expect(formAudience(form([]))).toBe('members');
    expect(formAudience(form([], { audience: 'members_and_guests' }))).toBe('members_and_guests');
    expect(isAnonymousForm(form([]))).toBe(false);
    expect(isAnonymousForm(form([], { anonymous: true }))).toBe(true);
    expect(isAnonymousForm(form([], { audience: 'anyone' }))).toBe(true);
    expect(isAnonymousForm(form([], { audience: 'members_and_guests' }))).toBe(false);
  });
});

describe('questionLabel', () => {
  it("uses the question's text, else the property's name", () => {
    expect(questionLabel(q(reason, { text: 'Why do you disagree?' }), reason)).toBe(
      'Why do you disagree?',
    );
    expect(questionLabel(q(reason, { text: '  ' }), reason)).toBe('Reason');
    expect(questionLabel(q(reason, { text: '' }), undefined)).toBe('Untitled');
  });
});

describe('conditionOps', () => {
  it('offers exactly the Forms spec conditions for each type', () => {
    const text = ['is', 'is_not', 'contains', 'does_not_contain', 'is_empty', 'is_not_empty'];
    for (const p of [name, reason, link, email, phone]) expect(conditionOps(p)).toEqual(text);
    expect(conditionOps(score)).toEqual([
      'eq',
      'neq',
      'gt',
      'lt',
      'gte',
      'lte',
      'is_empty',
      'is_not_empty',
    ]);
    expect(conditionOps(category)).toEqual(['is_any_of', 'is_none_of', 'is_empty', 'is_not_empty']);
    expect(conditionOps(tags)).toEqual([
      'contains_any',
      'contains_all',
      'contains_none',
      'is_empty',
      'is_not_empty',
    ]);
    expect(conditionOps(confirm)).toEqual(['is_checked', 'is_not_checked']);
    expect(conditionOps(callDate)).toEqual(['is', 'before', 'after', 'is_empty', 'is_not_empty']);
    expect(conditionOps(agent)).toEqual(['contains_any', 'is_empty', 'is_not_empty']);
    expect(conditionOps(review)).toEqual(['contains_any', 'is_empty', 'is_not_empty']);
    expect(conditionOps(files)).toEqual(['is_empty', 'is_not_empty']);
    expect(notAskable.map((p) => conditionOps(p))).toEqual(notAskable.map(() => []));
  });
  it('names each condition as the Forms spec does', () => {
    const ops: FormConditionOp[] = [
      'is',
      'is_not',
      'contains',
      'does_not_contain',
      'eq',
      'neq',
      'gt',
      'lt',
      'gte',
      'lte',
      'is_any_of',
      'is_none_of',
      'contains_any',
      'contains_all',
      'contains_none',
      'is_checked',
      'is_not_checked',
      'before',
      'after',
      'is_empty',
      'is_not_empty',
    ];
    expect(ops.map(conditionOpLabel)).toEqual([
      'is',
      'is not',
      'contains',
      'does not contain',
      'equals',
      'not equal',
      'greater than',
      'less than',
      'at least',
      'at most',
      'is any of',
      'is none of',
      'contains any of',
      'contains all of',
      'contains none of',
      'is ticked',
      'is not ticked',
      'is before',
      'is after',
      'is empty',
      'is not empty',
    ]);
  });
});

describe('conditions', () => {
  it('knows when a condition still waits for its value', () => {
    expect(isConditionSet(when(category, 'is_any_of'))).toBe(false);
    expect(isConditionSet(when(category, 'is_any_of', []))).toBe(false);
    expect(isConditionSet(when(reason, 'contains', '  '))).toBe(false);
    expect(isConditionSet(when(category, 'is_any_of', ['opt-billing']))).toBe(true);
    expect(isConditionSet(when(confirm, 'is_checked'))).toBe(true);
    expect(isConditionSet(when(reason, 'is_empty'))).toBe(true);
  });
  it('accepts conditions that fit their question, set up or not', () => {
    expect(conditionProblem(when(reason, 'contains', 'refund'), reason)).toBeNull();
    expect(conditionProblem(when(score, 'gte', '-2.5'), score)).toBeNull();
    expect(conditionProblem(when(callDate, 'before', '2026-10-26'), callDate)).toBeNull();
    expect(
      conditionProblem(when(tags, 'contains_all', ['opt-calls', 'opt-chats']), tags),
    ).toBeNull();
    expect(conditionProblem(when(agent, 'contains_any', ['me', 'u-jordan']), agent)).toBeNull();
    expect(conditionProblem(when(review, 'contains_any', ['row-12']), review)).toBeNull();
    expect(conditionProblem(when(confirm, 'is_checked'), confirm)).toBeNull();
    expect(conditionProblem(when(files, 'is_not_empty'), files)).toBeNull();
    expect(conditionProblem(when(score, 'eq'), score)).toBeNull();
  });
  it("refuses conditions that don't fit their question", () => {
    expect(conditionProblem(when(score, 'contains', '3'), score)).toBe(
      "That condition doesn't work for this question.",
    );
    expect(conditionProblem(when(confirm, 'is_empty'), confirm)).toBe(
      "That condition doesn't work for this question.",
    );
    expect(conditionProblem(when(score, 'gt', '1,000'), score)).toBe('Enter a number.');
    expect(conditionProblem(when(callDate, 'is', 'Oct 26'), callDate)).toBe('Enter a date.');
    expect(conditionProblem(when(category, 'is_any_of', ['opt-gone']), category)).toBe(
      "That option doesn't exist.",
    );
    expect(conditionProblem(when(category, 'is_any_of', 'opt-billing'), category)).toBe(
      "That condition's value doesn't work for this question.",
    );
    expect(conditionProblem(when(reason, 'is', ['x']), reason)).toBe(
      "That condition's value doesn't work for this question.",
    );
    expect(conditionProblem(when(agent, 'contains_any', 'u-jordan'), agent)).toBe(
      "That condition's value doesn't work for this question.",
    );
  });
});

describe('validateFormDefinition', () => {
  const good = form([
    q(name),
    q(category, { required: true }),
    q(reason, showIf(when(category, 'is_any_of', ['opt-billing']))),
    q(score, { logic: { combinator: 'or', conditions: [when(reason, 'is_not_empty')] } }),
  ]);
  it('accepts a good form, the default form and an empty one', () => {
    expect(validateFormDefinition(good, properties)).toBeNull();
    expect(
      validateFormDefinition(defaultForm('QA dispute request', properties), properties),
    ).toBeNull();
    expect(validateFormDefinition(form([]), properties)).toBeNull();
  });
  it('allows up to 100 questions', () => {
    const many = Array.from({ length: 101 }, (_, i) => q(prop(`p${i}`, `P${i}`, { type: 'text' })));
    const props = many.map((x) => prop(x.propertyId, x.text, { type: 'text' }));
    expect(validateFormDefinition(form(many.slice(0, 100)), props)).toBeNull();
    expect(validateFormDefinition(form(many), props)).toBe('Up to 100 questions.');
  });
  it('allows descriptions and the confirmation message up to 2,000 characters', () => {
    const message = 'Descriptions can be up to 2,000 characters.';
    expect(
      validateFormDefinition(form([q(name)], { description: long(2000) }), properties),
    ).toBeNull();
    expect(validateFormDefinition(form([q(name)], { description: long(2001) }), properties)).toBe(
      message,
    );
    expect(validateFormDefinition(form([q(name)], { confirmation: long(2001) }), properties)).toBe(
      message,
    );
    expect(validateFormDefinition(form([q(name, { description: long(2001) })]), properties)).toBe(
      message,
    );
  });
  it('needs each question to be a property that can be asked once', () => {
    expect(
      validateFormDefinition(form([q(prop('gone', 'Gone', { type: 'text' }))]), properties),
    ).toBe("That property doesn't exist.");
    expect(validateFormDefinition(form([q(category), q(category)]), properties)).toBe(
      "'Category' is already a question.",
    );
    expect(validateFormDefinition(form([q(stage)]), properties)).toBe(
      "'Stage' can't be a form question.",
    );
  });
  it('allows Files questions in anonymous forms', () => {
    expect(validateFormDefinition(form([q(files)], { anonymous: true }), properties)).toBeNull();
  });
  it("refuses only one response in anonymous forms, which don't keep names (FM-17)", () => {
    const message = 'One response per person needs names. Turn off anonymous responses first.';
    const single = { allowMultiple: false };
    expect(
      validateFormDefinition(form([q(name)], { ...single, anonymous: true }), properties),
    ).toBe(message);
    expect(
      validateFormDefinition(form([q(name)], { ...single, audience: 'anyone' }), properties),
    ).toBe(message);
    expect(validateFormDefinition(form([q(name)], single), properties)).toBeNull();
  });
  it('refuses Person and Relation questions when anyone can respond (FM-18)', () => {
    const message = "Forms anyone can fill in can't ask for people or rows.";
    const anyone = { audience: 'anyone' } as const;
    expect(validateFormDefinition(form([q(name), q(agent)], anyone), properties)).toBe(message);
    expect(validateFormDefinition(form([q(review)], anyone), properties)).toBe(message);
    expect(validateFormDefinition(form([q(name), q(files)], anyone), properties)).toBeNull();
    expect(
      validateFormDefinition(form([q(agent)], { audience: 'members_and_guests' }), properties),
    ).toBeNull();
  });
  it('keeps logic off the first question', () => {
    const first = q(name, showIf(when(category, 'is_empty')));
    expect(validateFormDefinition(form([first, q(category)]), properties)).toBe(
      "The first question can't have logic.",
    );
    const empty = q(name, { logic: { combinator: 'and', conditions: [] } });
    expect(validateFormDefinition(form([empty]), properties)).toBeNull();
  });
  it('allows up to 10 conditions', () => {
    const conditions = Array.from({ length: 11 }, (_, i) => ({
      ...when(category, 'is_not_empty'),
      id: `c${i}`,
    }));
    const def = (n: number) =>
      form([
        q(category),
        q(reason, { logic: { combinator: 'or', conditions: conditions.slice(0, n) } }),
      ]);
    expect(validateFormDefinition(def(10), properties)).toBeNull();
    expect(validateFormDefinition(def(11), properties)).toBe('Up to 10 conditions.');
  });
  it('allows conditions only on questions above', () => {
    const message = "'Why?' can only depend on questions above it.";
    const below = form([
      q(name),
      q(reason, { text: 'Why?', ...showIf(when(category, 'is_empty')) }),
      q(category),
    ]);
    expect(validateFormDefinition(below, properties)).toBe(message);
    const notAsked = form([
      q(name),
      q(reason, { text: 'Why?', ...showIf(when(score, 'is_empty')) }),
    ]);
    expect(validateFormDefinition(notAsked, properties)).toBe(message);
    const itself = form([
      q(name),
      q(reason, { text: 'Why?', ...showIf(when(reason, 'is_empty')) }),
    ]);
    expect(validateFormDefinition(itself, properties)).toBe(message);
  });
  it('checks each condition against the question it uses', () => {
    const def = (cond: FormCondition) => form([q(score), q(category), q(reason, showIf(cond))]);
    expect(validateFormDefinition(def(when(score, 'is_any_of', ['x'])), properties)).toBe(
      "That condition doesn't work for this question.",
    );
    expect(validateFormDefinition(def(when(score, 'gt', 'ten')), properties)).toBe(
      'Enter a number.',
    );
    expect(validateFormDefinition(def(when(category, 'is_any_of', ['opt-gone'])), properties)).toBe(
      "That option doesn't exist.",
    );
    expect(validateFormDefinition(def(when(category, 'is_none_of')), properties)).toBeNull();
  });
});

describe('anonymityWarning', () => {
  const warning = 'Answers can still show who sent them (Person questions, or what people type).';
  it('warns anonymous forms about Person questions and typed answers', () => {
    expect(anonymityWarning(form([q(category), q(agent)], { anonymous: true }), properties)).toBe(
      warning,
    );
    expect(anonymityWarning(form([q(reason)], { audience: 'anyone' }), properties)).toBe(warning);
    expect(anonymityWarning(form([q(email)], { anonymous: true }), properties)).toBe(warning);
  });
  it('stays quiet for choices only, and for forms that record senders', () => {
    const choices = [q(category), q(tags), q(callDate), q(confirm), q(files)];
    expect(anonymityWarning(form(choices, { anonymous: true }), properties)).toBeNull();
    expect(anonymityWarning(form([q(agent), q(reason)]), properties)).toBeNull();
  });
});
