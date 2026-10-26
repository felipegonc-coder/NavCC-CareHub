import { describe, expect, it } from 'vitest';
import { defaultConfig, defaultForm } from '../schema';
import type {
  FormCondition,
  FormConditionOp,
  FormDefinition,
  FormLogic,
  FormQuestion,
  Property,
  PropertyConfig,
  SelectOption,
} from '../types';
import {
  canMoveQuestion,
  moveQuestion,
  pruneLogic,
  visibleQuestions,
  walkQuestions,
} from './logic';

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
const details = prop('details', 'Details', { type: 'text' });
const score = prop('score', 'Score', defaultConfig('number'));
const tags = prop('tags', 'Tags', {
  type: 'multi_select',
  options: options('Calls', 'Chats', 'Emails'),
});
const callDate = prop('call-date', 'Call date', defaultConfig('date'));
const confirm = prop('confirm', 'I confirm', { type: 'checkbox' });
const agent = prop('agent', 'Agent', { type: 'person', single: false, notify: true });
const files = prop('files', 'Attachments', { type: 'files' });
const review = prop('review', 'Review', {
  type: 'relation',
  targetDatabaseId: 'db-reviews',
  single: false,
  twoWayPropertyId: null,
});
const properties = [
  name,
  category,
  reason,
  details,
  score,
  tags,
  callDate,
  confirm,
  agent,
  files,
  review,
];

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
const all = (...conditions: FormCondition[]): { logic: FormLogic } => ({
  logic: { combinator: 'and', conditions },
});
const any = (...conditions: FormCondition[]): { logic: FormLogic } => ({
  logic: { combinator: 'or', conditions },
});
const form = (questions: FormQuestion[], over: Partial<FormDefinition> = {}): FormDefinition => ({
  ...defaultForm('QA dispute request', []),
  questions,
  ...over,
});
const avery = { userId: 'u-avery', timeZone: 'America/Denver' };
const shown = (def: FormDefinition, answers: Record<string, unknown>, viewer = avery) => [
  ...visibleQuestions(def, answers, properties, viewer),
];
/** Whether a question that depends on `source` with one condition shows for this answer. */
const showsWhen = (source: Property, cond: FormCondition, answer: unknown, viewer = avery) =>
  shown(form([q(source), q(details, all(cond))]), { [source.id]: answer }, viewer).includes(
    'details',
  );

describe('visibleQuestions', () => {
  it('shows every question in order when there is no logic', () => {
    expect(shown(form([q(name), q(category), q(reason)]), {})).toEqual([
      'name',
      'category',
      'reason',
    ]);
  });
  it('matches All and Any logic as people answer (FM-03)', () => {
    const conds = [when(category, 'is_any_of', ['opt-billing']), when(score, 'gte', '3')];
    const allOf = form([q(category), q(score), q(reason, all(...conds))]);
    const anyOf = form([q(category), q(score), q(reason, any(...conds))]);
    const billing = { category: 'opt-billing', score: '2' };
    expect(shown(allOf, billing)).not.toContain('reason');
    expect(shown(allOf, { ...billing, score: '3' })).toContain('reason');
    expect(shown(anyOf, billing)).toContain('reason');
    expect(shown(anyOf, { category: 'opt-other', score: '1' })).not.toContain('reason');
    expect(shown(anyOf, {})).not.toContain('reason');
  });
  it('counts a hidden question as empty, so questions that depend on it hide too', () => {
    const def = form([
      q(category),
      q(reason, all(when(category, 'is_any_of', ['opt-billing']))),
      q(details, all(when(reason, 'is_not_empty'))),
      q(score, all(when(reason, 'is_empty'))),
    ]);
    const answers = { category: 'opt-coaching', reason: 'Wrong amount', details: 'See call' };
    expect(shown(def, answers)).toEqual(['category', 'score']);
    expect(shown(def, { ...answers, category: 'opt-billing' })).toEqual([
      'category',
      'reason',
      'details',
    ]);
  });
  it('compares text ignoring case and accents', () => {
    expect(showsWhen(reason, when(reason, 'is', 'BILLING'), 'billing')).toBe(true);
    expect(showsWhen(reason, when(reason, 'is', 'Billing'), 'Billing issue')).toBe(false);
    expect(showsWhen(reason, when(reason, 'is_not', 'Billing'), 'Billing issue')).toBe(true);
    expect(showsWhen(reason, when(reason, 'contains', 'cafe'), 'Café refund')).toBe(true);
    expect(showsWhen(reason, when(reason, 'does_not_contain', 'cafe'), 'Café refund')).toBe(false);
    expect(
      showsWhen(reason, when(reason, 'contains', 'refund'), [
        { text: 'Late ' },
        { text: 'refund' },
      ]),
    ).toBe(true);
    expect(showsWhen(name, when(name, 'is', 'blue pine plumbing'), ' Blue Pine Plumbing ')).toBe(
      true,
    );
  });
  it('compares numbers exactly', () => {
    expect(showsWhen(score, when(score, 'eq', '3'), '3.0')).toBe(true);
    expect(showsWhen(score, when(score, 'neq', '3'), '3')).toBe(false);
    expect(showsWhen(score, when(score, 'gt', '0.1'), '0.2')).toBe(true);
    expect(showsWhen(score, when(score, 'lt', '-1'), '-2')).toBe(true);
    expect(showsWhen(score, when(score, 'gte', '5'), '5')).toBe(true);
    expect(showsWhen(score, when(score, 'lte', '5'), '5.0001')).toBe(false);
    expect(showsWhen(score, when(score, 'gt', '4'), 4.5)).toBe(true);
  });
  it('matches select and multi-select options', () => {
    expect(
      showsWhen(category, when(category, 'is_any_of', ['opt-billing', 'opt-other']), 'opt-other'),
    ).toBe(true);
    expect(showsWhen(category, when(category, 'is_none_of', ['opt-billing']), 'opt-billing')).toBe(
      false,
    );
    expect(showsWhen(category, when(category, 'is_none_of', ['opt-billing']), 'opt-other')).toBe(
      true,
    );
    const calls = ['opt-calls', 'opt-chats'];
    expect(showsWhen(tags, when(tags, 'contains_any', ['opt-chats']), calls)).toBe(true);
    expect(showsWhen(tags, when(tags, 'contains_all', ['opt-calls', 'opt-emails']), calls)).toBe(
      false,
    );
    expect(showsWhen(tags, when(tags, 'contains_all', ['opt-calls', 'opt-chats']), calls)).toBe(
      true,
    );
    expect(showsWhen(tags, when(tags, 'contains_none', ['opt-emails']), calls)).toBe(true);
    expect(showsWhen(tags, when(tags, 'contains_none', ['opt-calls']), calls)).toBe(false);
  });
  it('matches ticked and unticked boxes', () => {
    expect(showsWhen(confirm, when(confirm, 'is_checked'), true)).toBe(true);
    expect(showsWhen(confirm, when(confirm, 'is_checked'), false)).toBe(false);
    expect(showsWhen(confirm, when(confirm, 'is_not_checked'), false)).toBe(true);
    expect(showsWhen(confirm, when(confirm, 'is_not_checked'), undefined)).toBe(true);
    expect(showsWhen(confirm, when(confirm, 'is_not_checked'), true)).toBe(false);
  });
  it("compares dates by their start day in the respondent's time zone", () => {
    const day = { start: '2026-10-26', end: '2026-10-28', hasTime: false };
    expect(showsWhen(callDate, when(callDate, 'is', '2026-10-26'), day)).toBe(true);
    expect(showsWhen(callDate, when(callDate, 'before', '2026-10-27'), day)).toBe(true);
    expect(showsWhen(callDate, when(callDate, 'after', '2026-10-26'), day)).toBe(false);
    expect(showsWhen(callDate, when(callDate, 'after', '2026-10-25'), day)).toBe(true);
    // 03:30 UTC on Oct 27 is still Oct 26 in Denver, but Oct 27 in London.
    const late = { start: '2026-10-27T03:30:00.000Z', end: null, hasTime: true };
    const london = { userId: 'u-avery', timeZone: 'Europe/London' };
    expect(showsWhen(callDate, when(callDate, 'is', '2026-10-26'), late)).toBe(true);
    expect(showsWhen(callDate, when(callDate, 'is', '2026-10-26'), late, london)).toBe(false);
  });
  it('matches people (with "Me" as the respondent), related rows and files', () => {
    expect(showsWhen(agent, when(agent, 'contains_any', ['me']), ['u-avery'])).toBe(true);
    const jordan = { userId: 'u-jordan', timeZone: 'America/Denver' };
    expect(showsWhen(agent, when(agent, 'contains_any', ['me']), ['u-avery'], jordan)).toBe(false);
    expect(
      showsWhen(agent, when(agent, 'contains_any', ['u-jordan']), ['u-avery', 'u-jordan']),
    ).toBe(true);
    expect(showsWhen(review, when(review, 'contains_any', ['row-12']), ['row-7'])).toBe(false);
    expect(showsWhen(review, when(review, 'contains_any', ['row-12']), ['row-12'])).toBe(true);
    const file = { id: 'up-1', name: 'call.mp3', size: 1200, mime: 'audio/mpeg' };
    expect(showsWhen(files, when(files, 'is_not_empty'), [file])).toBe(true);
    expect(showsWhen(files, when(files, 'is_empty'), [file])).toBe(false);
  });
  it('treats blank answers as empty', () => {
    for (const [source, answer] of [
      [reason, '   '],
      [reason, []],
      [score, ''],
      [category, ''],
      [tags, []],
      [callDate, { start: 'not a date', end: null, hasTime: false }],
      [files, []],
      [agent, null],
    ] as const) {
      expect(showsWhen(source, when(source, 'is_empty'), answer)).toBe(true);
      expect(showsWhen(source, when(source, 'is_not_empty'), answer)).toBe(false);
    }
  });
  it('gives each condition its natural result for an empty answer', () => {
    const empty: [Property, FormCondition, boolean][] = [
      [reason, when(reason, 'is', 'x'), false],
      [reason, when(reason, 'is_not', 'x'), true],
      [reason, when(reason, 'contains', 'x'), false],
      [reason, when(reason, 'does_not_contain', 'x'), true],
      [score, when(score, 'eq', '1'), false],
      [score, when(score, 'neq', '1'), true],
      [score, when(score, 'gt', '1'), false],
      [category, when(category, 'is_any_of', ['opt-billing']), false],
      [category, when(category, 'is_none_of', ['opt-billing']), true],
      [tags, when(tags, 'contains_all', ['opt-calls']), false],
      [tags, when(tags, 'contains_none', ['opt-calls']), true],
      [callDate, when(callDate, 'before', '2026-10-26'), false],
    ];
    for (const [source, cond, expected] of empty)
      expect(showsWhen(source, cond, undefined)).toBe(expected);
  });
  it("ignores conditions still being set up or that don't fit their question", () => {
    expect(showsWhen(category, when(category, 'is_any_of', []), 'opt-other')).toBe(true);
    expect(showsWhen(reason, when(reason, 'contains'), 'anything')).toBe(true);
    expect(showsWhen(score, when(score, 'contains', '3'), '4')).toBe(true);
    const def = form([
      q(category),
      q(reason, any(when(category, 'is_any_of'), when(category, 'is_any_of', ['opt-billing']))),
    ]);
    expect(shown(def, { category: 'opt-other' })).toEqual(['category']);
  });
  it('treats a question that left the form as empty, and skips questions it can no longer ask', () => {
    const def = form([
      q(prop('gone', 'Gone', { type: 'text' })),
      q(reason, all(when(prop('gone', 'Gone', { type: 'text' }), 'is_not_empty'))),
      q(details, all(when(score, 'is_empty'))),
      q(files),
    ]);
    expect(shown(def, { gone: 'x', reason: 'y' })).toEqual(['details', 'files']);
    expect(shown({ ...def, anonymous: true }, {})).toEqual(['details']);
    expect(shown(form([q(reason), q(reason)]), {})).toEqual(['reason']);
  });
});

describe('walkQuestions', () => {
  it('visits each question once, in order, with whether it shows', () => {
    const def = form([q(category), q(reason, all(when(category, 'is_not_empty')))]);
    const steps: string[] = [];
    walkQuestions(def, properties, avery, false, ({ question, prop: p, shown: s }) => {
      steps.push(`${question.propertyId}:${p.name}:${s}`);
      return null;
    });
    expect(steps).toEqual(['category:Category:true', 'reason:Reason:false']);
  });
});

describe('moving questions', () => {
  const def = form([
    q(name),
    q(category),
    q(reason, all(when(category, 'is_any_of', ['opt-billing']))),
    q(score),
  ]);
  it('blocks moving a question above one it depends on (FM-05)', () => {
    const message = "'Reason' depends on 'Category', so it must stay below it.";
    expect(canMoveQuestion(def, 2, 1, properties)).toBe(message);
    expect(canMoveQuestion(def, 2, 0, properties)).toBe(message);
    expect(canMoveQuestion(def, 1, 2, properties)).toBe(message);
    expect(canMoveQuestion(def, 1, 3, properties)).toBe(message);
  });
  it('allows every other move', () => {
    expect(canMoveQuestion(def, 2, 3, properties)).toBeNull();
    expect(canMoveQuestion(def, 0, 3, properties)).toBeNull();
    expect(canMoveQuestion(def, 3, 0, properties)).toBeNull();
    expect(canMoveQuestion(def, 1, 0, properties)).toBeNull();
    expect(canMoveQuestion(def, 2, 2, properties)).toBeNull();
    expect(canMoveQuestion(def, 9, 0, properties)).toBeNull();
    expect(canMoveQuestion(def, 0, 9, properties)).toBeNull();
  });
  it("names questions by their text, else their property's name", () => {
    const renamed = form([
      q(category, { text: '' }),
      q(reason, { text: 'Why do you disagree?', ...all(when(category, 'is_not_empty')) }),
    ]);
    expect(canMoveQuestion(renamed, 0, 1, properties)).toBe(
      "'Why do you disagree?' depends on 'Category', so it must stay below it.",
    );
  });
  it("doesn't blame a move for a dependency that was already broken", () => {
    const broken = form([q(reason, all(when(category, 'is_not_empty'))), q(category), q(score)]);
    expect(canMoveQuestion(broken, 1, 2, properties)).toBeNull();
    expect(canMoveQuestion(broken, 0, 2, properties)).toBeNull();
  });
  it('moves a question so it ends up at the new position', () => {
    const order = (d: FormDefinition) => d.questions.map((x) => x.propertyId);
    expect(order(moveQuestion(def, 3, 0))).toEqual(['score', 'name', 'category', 'reason']);
    expect(order(moveQuestion(def, 0, 2))).toEqual(['category', 'reason', 'name', 'score']);
    expect(order(moveQuestion(def, 0, 99))).toEqual(['category', 'reason', 'score', 'name']);
    expect(moveQuestion(def, 7, 0)).toBe(def);
  });
});

describe('pruneLogic', () => {
  const def = form([
    q(name),
    q(category),
    q(score),
    q(reason, any(when(category, 'is_any_of', ['opt-billing']), when(score, 'gt', '2'))),
    q(details, all(when(category, 'is_none_of', ['opt-other']))),
  ]);
  it('leaves a form alone when nothing it uses was deleted', () => {
    const result = pruneLogic(def, properties);
    expect(result.def).toBe(def);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
  });
  it("removes a deleted property's question and the conditions on it, marking Logic changed (FM-06)", () => {
    const result = pruneLogic(
      def,
      properties.filter((p) => p.id !== 'category'),
    );
    expect(result.removed).toEqual(['category']);
    expect(result.changed).toEqual(['reason', 'details']);
    const [, , reasonQ, detailsQ] = result.def.questions;
    expect(result.def.questions.map((x) => x.propertyId)).toEqual([
      'name',
      'score',
      'reason',
      'details',
    ]);
    expect(reasonQ).toMatchObject({
      logic: { combinator: 'or', conditions: [when(score, 'gt', '2')] },
      logicChanged: true,
    });
    expect(detailsQ).toMatchObject({ logic: null, logicChanged: true });
  });
  it('removes conditions that use a deleted option', () => {
    const noBilling = prop('category', 'Category', {
      type: 'select',
      options: options('Coaching', 'Other'),
    });
    const result = pruneLogic(
      def,
      properties.map((p) => (p.id === 'category' ? noBilling : p)),
    );
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual(['reason']);
    expect(result.def.questions[3]?.logic?.conditions).toEqual([when(score, 'gt', '2')]);
    expect(result.def.questions[4]).toBe(def.questions[4]);
  });
  it("removes questions and conditions whose property changed to a type that doesn't fit", () => {
    const asStatus = prop('category', 'Category', defaultConfig('status'));
    const scoreAsText = prop('score', 'Score', { type: 'text' });
    const changedProps = properties.map((p) =>
      p.id === 'category' ? asStatus : p.id === 'score' ? scoreAsText : p,
    );
    const result = pruneLogic(def, changedProps);
    expect(result.removed).toEqual(['category']);
    expect(result.changed).toEqual(['reason', 'details']);
    expect(result.def.questions[2]).toMatchObject({
      propertyId: 'reason',
      logic: null,
      logicChanged: true,
    });
  });
  it('removes conditions on questions that left the form or are no longer above', () => {
    const removedQuestion = {
      ...def,
      questions: def.questions.filter((x) => x.propertyId !== 'score'),
    };
    expect(pruneLogic(removedQuestion, properties).def.questions[2]?.logic?.conditions).toEqual([
      when(category, 'is_any_of', ['opt-billing']),
    ]);
    const firstWithLogic = form([q(reason, all(when(category, 'is_not_empty'))), q(category)]);
    const result = pruneLogic(firstWithLogic, properties);
    expect(result.changed).toEqual(['reason']);
    expect(result.def.questions[0]).toMatchObject({ logic: null, logicChanged: true });
  });
});
