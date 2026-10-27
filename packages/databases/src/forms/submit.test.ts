import { describe, expect, it, vi } from 'vitest';
import { normalizeDecimal } from '../decimal';
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
import { checkSubmission, draftKey, type AnswerCheck, type SubmissionOptions } from './submit';

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
const callDate = prop('call-date', 'Call date', defaultConfig('date'));
const confirm = prop('confirm', 'I confirm', { type: 'checkbox' });
const followUp = prop('follow-up', 'Follow up', { type: 'checkbox' });
const email = prop('email', 'Email', { type: 'email' });
const agent = prop('agent', 'Agent', { type: 'person', single: true, notify: true });
const files = prop('files', 'Attachments', { type: 'files' });
const stage = prop('stage', 'Stage', {
  type: 'status',
  options: [
    { id: 'st-new', name: 'New', color: 'default', group: 'todo' },
    { id: 'st-review', name: 'In review', color: 'blue', group: 'in_progress' },
    { id: 'st-done', name: 'Resolved', color: 'green', group: 'complete' },
  ],
  defaultOptionId: 'st-review',
});
const steps = prop('steps', 'Steps', { type: 'checklist' });
const properties = [
  name,
  category,
  reason,
  score,
  callDate,
  confirm,
  followUp,
  email,
  agent,
  files,
  stage,
  steps,
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
const showIf = (...conditions: FormCondition[]): Pick<FormQuestion, 'logic'> => ({
  logic: { combinator: 'and', conditions },
});
const form = (questions: FormQuestion[], over: Partial<FormDefinition> = {}): FormDefinition => ({
  ...defaultForm('QA dispute request', []),
  questions,
  ...over,
});

/** A stand-in for values.ts validateValue covering the types these tests use. */
const makeValidate = () =>
  vi.fn((p: Property, v: unknown): AnswerCheck => {
    switch (p.config.type) {
      case 'title':
        return typeof v === 'string'
          ? { ok: true, value: v.trim() }
          : { ok: false, error: 'Bad name' };
      case 'text':
        return typeof v === 'string'
          ? { ok: true, value: v.trim() ? [{ text: v.trim() }] : null }
          : { ok: false, error: 'Bad text' };
      case 'number': {
        const d = typeof v === 'string' ? normalizeDecimal(v) : null;
        return d === null ? { ok: false, error: 'Enter a number.' } : { ok: true, value: d };
      }
      case 'email':
        return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
          ? { ok: true, value: v }
          : { ok: false, error: 'Enter an email address like name@example.com.' };
      case 'person':
        return Array.isArray(v) && v.length > 1
          ? { ok: false, error: 'This property allows one person only.' }
          : { ok: true, value: v };
      default:
        return { ok: true, value: v };
    }
  });
const base = (over: Partial<SubmissionOptions> = {}): SubmissionOptions => ({
  validate: makeValidate(),
  respondentName: 'Avery Lin',
  anonymous: false,
  ...over,
});

const dispute = form([
  q(name),
  q(category, { required: true }),
  q(reason, { required: true, ...showIf(when(category, 'is_any_of', ['opt-billing'])) }),
  q(score),
  q(confirm),
]);

describe('checkSubmission', () => {
  it('makes the row from the answers, with defaults for what was not asked (FM-02)', () => {
    const result = checkSubmission(
      dispute,
      properties,
      {
        name: ' Blue Pine Plumbing callback ',
        category: 'opt-billing',
        reason: 'Charged twice',
        score: '4.50',
        confirm: true,
      },
      base(),
    );
    expect(result).toEqual({
      ok: true,
      title: 'Blue Pine Plumbing callback',
      values: {
        category: 'opt-billing',
        reason: [{ text: 'Charged twice' }],
        score: '4.5',
        confirm: true,
        'follow-up': false,
        stage: 'st-review',
      },
    });
  });
  it('names the row after the respondent when Name is not asked or left blank', () => {
    const noName = form([q(category)]);
    const ok = { ok: true, title: 'Response from Avery Lin' };
    expect(checkSubmission(noName, properties, { category: 'opt-other' }, base())).toMatchObject(
      ok,
    );
    expect(
      checkSubmission(dispute, properties, { name: '  ', category: 'opt-other' }, base()),
    ).toMatchObject(ok);
    const unnamed = base({ respondentName: null });
    expect(checkSubmission(noName, properties, {}, unnamed)).toMatchObject({ ok: true, title: '' });
  });
  it('never names the respondent of an anonymous response (FM-16)', () => {
    const anonymousForm = form([q(category)], { anonymous: true });
    expect(checkSubmission(anonymousForm, properties, {}, base())).toMatchObject({
      ok: true,
      title: 'Anonymous response',
    });
    expect(
      checkSubmission(form([q(category)]), properties, {}, base({ anonymous: true })),
    ).toMatchObject({
      title: 'Anonymous response',
    });
    expect(
      checkSubmission(
        form([q(name)], { anonymous: true }),
        properties,
        { name: 'Billing dispute' },
        base(),
      ),
    ).toMatchObject({ title: 'Billing dispute' });
    expect(
      checkSubmission(form([q(category)], { audience: 'anyone' }), properties, {}, base()),
    ).toMatchObject({ ok: true, title: 'Anonymous response' });
  });
  it('drops Person answers in a form anyone can fill in without checking them', () => {
    const validate = makeValidate();
    const def = form([q(category), q(agent, { required: true })], { audience: 'anyone' });
    const result = checkSubmission(
      def,
      properties,
      { category: 'opt-other', agent: ['u-avery'] },
      base({ validate }),
    );
    expect(result).toMatchObject({ ok: true, values: { category: 'opt-other' } });
    expect(result.ok && 'agent' in result.values).toBe(false);
    expect(validate).toHaveBeenCalledTimes(1);
  });
  it('drops answers to hidden questions without checking them (FM-03)', () => {
    const validate = makeValidate();
    const result = checkSubmission(
      dispute,
      properties,
      { category: 'opt-coaching', reason: 'Sneaked in', score: '3' },
      base({ validate }),
    );
    expect(result).toMatchObject({ ok: true, values: { category: 'opt-coaching', score: '3' } });
    expect(result.ok && 'reason' in result.values).toBe(false);
    expect(validate.mock.calls.map(([p]) => p.id)).toEqual(['category', 'score']);
  });
  it('drops answers to removed questions and properties that were not asked', () => {
    const result = checkSubmission(
      form([q(category)]),
      properties,
      {
        category: 'opt-other',
        stage: 'st-done',
        steps: [{ id: 'i1', text: 'x', done: true }],
        ghost: 'x',
      },
      base(),
    );
    expect(result).toEqual({
      ok: true,
      title: 'Response from Avery Lin',
      values: { category: 'opt-other', confirm: false, 'follow-up': false, stage: 'st-review' },
    });
  });
  it('requires visible required questions only (FM-04)', () => {
    const missing = checkSubmission(dispute, properties, { category: 'opt-billing' }, base());
    expect(missing).toEqual({
      ok: false,
      errors: { reason: 'Answer this question.' },
      summary: '1 question needs an answer',
      formChanged: false,
    });
    expect(checkSubmission(dispute, properties, { category: 'opt-other' }, base()).ok).toBe(true);
    const blank = checkSubmission(
      dispute,
      properties,
      { category: 'opt-billing', reason: '   ' },
      base(),
    );
    expect(blank).toMatchObject({ ok: false, errors: { reason: 'Answer this question.' } });
  });
  it('needs a required checkbox to be ticked', () => {
    const def = form([q(confirm, { required: true, text: 'I confirm the call was reviewed' })]);
    for (const answer of [false, undefined]) {
      expect(checkSubmission(def, properties, { confirm: answer }, base())).toMatchObject({
        ok: false,
        errors: { confirm: 'Tick this box to continue.' },
      });
    }
    expect(checkSubmission(def, properties, { confirm: true }, base())).toMatchObject({
      ok: true,
      values: { confirm: true },
    });
  });
  it('reports format errors under each question with a count at the top', () => {
    const def = form([q(category, { required: true }), q(email), q(agent), q(score)]);
    const result = checkSubmission(
      def,
      properties,
      { email: 'avery@', agent: ['u-avery', 'u-jordan'], score: '12' },
      base(),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        category: 'Answer this question.',
        email: 'Enter an email address like name@example.com.',
        agent: 'This property allows one person only.',
      },
      summary: '3 questions need answers',
      formChanged: false,
    });
  });
  it('treats an answer that fails its check as empty for the questions below it', () => {
    const def = form([
      q(score),
      q(reason, { required: true, ...showIf(when(score, 'is_not_empty')) }),
    ]);
    expect(checkSubmission(def, properties, { score: 'lots' }, base())).toEqual({
      ok: false,
      errors: { score: 'Enter a number.' },
      summary: '1 question needs an answer',
      formChanged: false,
    });
  });
  it('says the form changed when a new required question was never seen (FM-10)', () => {
    const answers = { category: 'opt-billing' };
    const seen = ['name', 'category', 'score', 'confirm'];
    expect(checkSubmission(dispute, properties, answers, base({ seenQuestionIds: seen }))).toEqual({
      ok: false,
      errors: { reason: 'Answer this question.' },
      summary: 'This form changed. Please answer the new question.',
      formChanged: true,
    });
    const twoNew = form([q(category, { required: true }), q(reason, { required: true })]);
    expect(
      checkSubmission(twoNew, properties, {}, base({ seenQuestionIds: ['name'] })),
    ).toMatchObject({
      summary: 'This form changed. Please answer the new questions.',
      formChanged: true,
    });
    expect(
      checkSubmission(dispute, properties, answers, base({ seenQuestionIds: [...seen, 'reason'] })),
    ).toMatchObject({
      summary: '1 question needs an answer',
      formChanged: false,
    });
    const optional = form([q(category), q(score)]);
    expect(
      checkSubmission(optional, properties, {}, base({ seenQuestionIds: ['category'] })).ok,
    ).toBe(true);
    expect(
      checkSubmission(
        dispute,
        properties,
        { category: 'opt-other' },
        base({ seenQuestionIds: seen }),
      ).ok,
    ).toBe(true);
  });
  it('allows up to 10 files, also in anonymous forms', () => {
    const file = (i: number) => ({
      id: `up-${i}`,
      name: `call-${i}.mp3`,
      size: 100,
      mime: 'audio/mpeg',
    });
    const list = (n: number) => Array.from({ length: n }, (_, i) => file(i));
    const def = form([q(files)]);
    expect(checkSubmission(def, properties, { files: list(10) }, base())).toMatchObject({
      ok: true,
      values: { files: list(10) },
    });
    expect(checkSubmission(def, properties, { files: list(11) }, base())).toMatchObject({
      ok: false,
      errors: { files: 'Up to 10 files.' },
    });
    expect(
      checkSubmission(
        form([q(files)], { anonymous: true }),
        properties,
        { files: list(2) },
        base(),
      ),
    ).toMatchObject({ ok: true, title: 'Anonymous response', values: { files: list(2) } });
  });
  it("uses the respondent's time zone and id for logic", () => {
    const def = form([
      q(callDate),
      q(agent),
      q(reason, { required: true, ...showIf(when(callDate, 'is', '2026-10-26')) }),
      q(score, { required: true, ...showIf(when(agent, 'contains_any', ['me'])) }),
    ]);
    const answers = {
      'call-date': { start: '2026-10-27T03:30:00.000Z', end: null, hasTime: true },
      agent: ['u-avery'],
    };
    const denver = base({ viewer: { userId: 'u-avery', timeZone: 'America/Denver' } });
    const london = base({ viewer: { userId: 'u-jordan', timeZone: 'Europe/London' } });
    expect(checkSubmission(def, properties, answers, denver)).toMatchObject({
      errors: { reason: 'Answer this question.', score: 'Answer this question.' },
    });
    expect(checkSubmission(def, properties, answers, london).ok).toBe(true);
    expect(checkSubmission(def, properties, answers, base())).toMatchObject({
      errors: { reason: 'Answer this question.' },
    });
  });
  it('falls back to the first To-do option when the Status default is gone', () => {
    const noDefault = prop('stage', 'Stage', {
      ...defaultConfig('status'),
      defaultOptionId: 'missing',
    });
    const result = checkSubmission(form([]), [name, noDefault], {}, base());
    const firstTodo = noDefault.config.type === 'status' ? noDefault.config.options[0]?.id : null;
    expect(result).toEqual({
      ok: true,
      title: 'Response from Avery Lin',
      values: { stage: firstTodo },
    });
  });
});

describe('draftKey', () => {
  it('keeps one draft per form and person', () => {
    expect(draftKey('form-1', 'u-avery')).toBe('carehub:form-draft:form-1:u-avery');
    expect(draftKey('form-1', 'u-jordan')).not.toBe(draftKey('form-1', 'u-avery'));
    expect(draftKey('form-1', null)).toBe('carehub:form-draft:form-1:signed-out');
  });
});
