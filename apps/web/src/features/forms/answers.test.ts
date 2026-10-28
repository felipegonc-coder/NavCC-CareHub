import { beforeEach, describe, expect, it } from 'vitest';
import { draftKey, visibleQuestions } from '@carehub/databases/forms';
import { validateValue } from '@carehub/databases/values';
import {
  answerInput,
  answerInputs,
  askedQuestions,
  clearDraft,
  dateInput,
  EMPTY_DATE,
  loadDraft,
  logicValues,
  newQuestionsText,
  responseAnswers,
  saveDraft,
  uploadingText,
} from './answers';
import { formProperties, IDS, question, testForm } from './test-utils';

const DENVER = 'America/Denver';

describe('askedQuestions', () => {
  it('leaves out Person and Relation questions when anyone can fill the form in', () => {
    const questions = [
      question(IDS.name, 'Your name'),
      question(IDS.assignee, 'Assigned to'),
      question(IDS.job, 'Job'),
      question(IDS.photos, 'Photos'),
    ];
    const members = askedQuestions(testForm({ questions }), formProperties);
    const anyone = askedQuestions(testForm({ questions, audience: 'anyone' }), formProperties);
    expect(members.map((q) => q.kind)).toEqual(['short', 'person', 'relation', 'files']);
    expect(anyone.map((q) => q.label)).toEqual(['Your name', 'Photos']);
  });

  it('shows selects with more than 7 options as a dropdown', () => {
    const asked = askedQuestions(
      testForm({ questions: [question(IDS.category, 'Category'), question(IDS.site, 'Site')] }),
      formProperties,
    );
    expect(asked.map((q) => q.kind)).toEqual(['radio', 'dropdown']);
  });
});

describe('answerInput', () => {
  it('turns what the controls hold into what the checks take', () => {
    expect(answerInput('short', '  ', DENVER)).toBeNull();
    expect(answerInput('number', '12.5', DENVER)).toBe('12.5');
    expect(answerInput('radio', '', DENVER)).toBeNull();
    expect(answerInput('checkboxes', ['opt-tag-1'], DENVER)).toEqual(['opt-tag-1']);
    expect(answerInput('checkbox', true, DENVER)).toBe(true);
    expect(answerInput('person', [{ id: 'user-avery', label: 'Avery Lin' }], DENVER)).toEqual([
      'user-avery',
    ]);
  });

  it('turns a date with a time into the moment in the person’s time zone', () => {
    expect(dateInput({ ...EMPTY_DATE, start: '2026-10-27' }, DENVER)).toEqual({
      start: '2026-10-27',
      end: null,
      hasTime: false,
    });
    expect(
      dateInput({ ...EMPTY_DATE, start: '2026-10-27', startTime: '09:00', hasTime: true }, DENVER),
    ).toEqual({ start: '2026-10-27T15:00:00.000Z', end: null, hasTime: true });
    expect(dateInput(EMPTY_DATE, DENVER)).toBeNull();
  });

  it('lets a date that is not one fail its check', () => {
    const visit = formProperties.find((p) => p.id === IDS.visit);
    if (!visit) throw new Error('fixture');
    const input = dateInput({ ...EMPTY_DATE, start: '2026-02-30' }, DENVER);
    expect(validateValue(visit, input)).toEqual({ ok: false, error: 'Enter a date.' });
  });
});

describe('logic and responses', () => {
  const def = testForm();
  const asked = askedQuestions(def, formProperties);
  const viewer = { userId: 'user-avery', timeZone: DENVER };

  it('shows "Reason for dispute" only for disputes, and sends only what shows', () => {
    const answers = {
      [IDS.name]: 'Avery Lin',
      [IDS.category]: 'opt-billing',
      [IDS.reason]: 'Late',
    };
    const inputs = answerInputs(asked, answers, DENVER);
    const shown = visibleQuestions(def, logicValues(asked, inputs), formProperties, viewer);
    expect(shown.has(IDS.reason)).toBe(false);
    expect(responseAnswers(inputs, shown)).toEqual({
      [IDS.name]: 'Avery Lin',
      [IDS.category]: 'opt-billing',
    });

    const dispute = answerInputs(asked, { ...answers, [IDS.category]: 'opt-dispute' }, DENVER);
    expect(
      visibleQuestions(def, logicValues(asked, dispute), formProperties, viewer).has(IDS.reason),
    ).toBe(true);
  });
});

describe('drafts', () => {
  const key = draftKey('form-1', 'user-avery');
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps unsent answers and forgets them when cleared', () => {
    saveDraft(key, { [IDS.name]: 'Jordan Park' }, 'local');
    expect(loadDraft(key, 'local')).toEqual({ [IDS.name]: 'Jordan Park' });
    expect(window.sessionStorage.getItem(key)).toBeNull();
    clearDraft(key, 'local');
    expect(loadDraft(key, 'local')).toBeNull();
  });

  it('keeps a signed-out draft for this tab only', () => {
    const anonymous = draftKey('form-1', null);
    saveDraft(anonymous, { [IDS.name]: 'Jordan Park' }, 'session');
    expect(window.localStorage.length).toBe(0);
    expect(loadDraft(anonymous, 'session')).toEqual({ [IDS.name]: 'Jordan Park' });
    expect(loadDraft(anonymous, 'local')).toBeNull();
    clearDraft(anonymous, 'session');
    expect(window.sessionStorage.getItem(anonymous)).toBeNull();
  });

  it('keeps nothing when nothing is answered', () => {
    saveDraft(key, { [IDS.name]: '', [IDS.tags]: [], [IDS.visit]: EMPTY_DATE }, 'local');
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});

describe('texts', () => {
  it('words the announcements', () => {
    expect(newQuestionsText(['Reason for dispute'])).toBe('1 new question: Reason for dispute');
    expect(newQuestionsText(['Reason', 'Amount'])).toBe('2 new questions: Reason, Amount');
    expect(uploadingText(2)).toBe('Uploading 2 files…');
    expect(uploadingText(1)).toBe('Uploading 1 file…');
  });
});
