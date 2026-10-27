import { describe, expect, it } from 'vitest';
import type { Property } from '@carehub/databases';
import {
  addQuestion,
  changeLogic,
  changeQuestion,
  closeAtFromValue,
  closeAtValue,
  displaySetting,
  formUrl,
  maxResponsesFrom,
  newCondition,
  questionsAbove,
  removeQuestion,
  viewForm,
  withNotify,
} from './definition';
import { IDS, formProperties, question, testForm } from './test-utils';

function prop(id: string): Property {
  const found = formProperties.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
}

/** Category without its Dispute option. */
const withoutDispute = formProperties.map((p) =>
  p.id === IDS.category && p.config.type === 'select'
    ? {
        ...p,
        config: { ...p.config, options: p.config.options.filter((o) => o.id !== 'opt-dispute') },
      }
    : p,
);

describe('viewForm', () => {
  it('gives a view without a form one titled with the database name, asking for Name', () => {
    const def = viewForm({}, { title: 'Requests', properties: formProperties });
    expect(def.title).toBe('Requests');
    expect(def.questions.map((q) => q.propertyId)).toEqual([IDS.name]);
    expect(def.anonymous).toBe(false);
    expect(def.accepting).toBe(true);
  });

  it('drops a condition whose option was deleted and marks its question "Logic changed"', () => {
    const def = viewForm({ form: testForm() }, { title: 'Requests', properties: withoutDispute });
    const reason = def.questions.find((q) => q.propertyId === IDS.reason);
    expect(reason?.logic).toBeNull();
    expect(reason?.logicChanged).toBe(true);
  });

  it('leaves a form that still fits as it is', () => {
    const form = testForm();
    expect(viewForm({ form }, { title: 'Requests', properties: formProperties })).toBe(form);
  });
});

describe('questions', () => {
  it('adds a property once, its question text starting as the property name', () => {
    const def = addQuestion(testForm(), prop(IDS.notes));
    expect(def.questions[def.questions.length - 1]).toEqual(question(IDS.notes, 'Notes'));
    expect(addQuestion(def, prop(IDS.notes))).toBe(def);
  });

  it('removing a question drops the conditions that used it', () => {
    const def = removeQuestion(testForm(), IDS.category, formProperties);
    expect(def.questions.map((q) => q.propertyId)).not.toContain(IDS.category);
    const reason = def.questions.find((q) => q.propertyId === IDS.reason);
    expect(reason?.logic).toBeNull();
    expect(reason?.logicChanged).toBe(true);
  });

  it('changes one question', () => {
    const def = changeQuestion(testForm(), IDS.amount, { text: 'Amount in USD', required: true });
    expect(def.questions[3]).toMatchObject({ text: 'Amount in USD', required: true });
    expect(def.questions[4]).toMatchObject({ text: 'Email', required: false });
  });

  it('new logic clears "Logic changed", and no conditions means no logic', () => {
    const changed = removeQuestion(testForm(), IDS.category, formProperties);
    const cond = newCondition(prop(IDS.name));
    const withLogic = changeLogic(changed, IDS.reason, { combinator: 'or', conditions: [cond] });
    const reason = withLogic.questions.find((q) => q.propertyId === IDS.reason);
    expect(reason?.logic).toEqual({ combinator: 'or', conditions: [cond] });
    expect(reason?.logicChanged).toBeUndefined();
    const cleared = changeLogic(withLogic, IDS.reason, { combinator: 'and', conditions: [] });
    expect(cleared.questions.find((q) => q.propertyId === IDS.reason)?.logic).toBeNull();
  });

  it('a new condition takes the first kind of condition and waits for its value', () => {
    expect(newCondition(prop(IDS.category))).toMatchObject({
      questionPropertyId: IDS.category,
      op: 'is_any_of',
    });
    expect(newCondition(prop(IDS.agree)).op).toBe('is_checked');
    expect(newCondition(prop(IDS.category)).value).toBeUndefined();
  });

  it('logic can only use the questions above', () => {
    const above = questionsAbove(testForm(), IDS.reason).map((q) => q.propertyId);
    expect(above).toEqual([IDS.name, IDS.category]);
    expect(questionsAbove(testForm(), IDS.name)).toEqual([]);
  });

  it('offers Long answer for text and Always a dropdown for selects', () => {
    expect(displaySetting(prop(IDS.reason))).toEqual({ label: 'Long answer', display: 'long' });
    expect(displaySetting(prop(IDS.tags))).toEqual({
      label: 'Always a dropdown',
      display: 'dropdown',
    });
    expect(displaySetting(prop(IDS.amount))).toBeNull();
  });
});

describe('settings', () => {
  it('builds the form link', () => {
    expect(formUrl('abc123', 'https://hub.example')).toBe('https://hub.example/forms/abc123');
  });

  it("shows and reads a close time in the viewer's time zone", () => {
    expect(closeAtValue('2026-10-30T23:00:00.000Z', 'America/Denver')).toBe('2026-10-30T17:00');
    expect(closeAtFromValue('2026-10-30T17:00', 'America/Denver')).toBe('2026-10-30T23:00:00.000Z');
    expect(closeAtValue(null, 'America/Denver')).toBe('');
    expect(closeAtFromValue('', 'America/Denver')).toBeNull();
  });

  it('reads "Close after a number of responses"', () => {
    expect(maxResponsesFrom('')).toBeNull();
    expect(maxResponsesFrom(' 25 ')).toBe(25);
    expect(maxResponsesFrom('0')).toBeUndefined();
    expect(maxResponsesFrom('2.5')).toBeUndefined();
    expect(maxResponsesFrom('ten')).toBeUndefined();
  });

  it('turns "Notify me" on and off for one person', () => {
    const on = withNotify(testForm({ notifyUserIds: ['user-jordan'] }), 'user-avery', true);
    expect(on.notifyUserIds).toEqual(['user-jordan', 'user-avery']);
    expect(withNotify(on, 'user-avery', false).notifyUserIds).toEqual(['user-jordan']);
  });
});
