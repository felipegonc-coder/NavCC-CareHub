import { describe, expect, it } from 'vitest';
import {
  countText,
  courseOptions,
  emptyDraft,
  errorsFromIssues,
  findPeople,
  localToday,
  requestFrom,
  targetValue,
  type AssignDraft,
} from './form';

// Fictional people and courses only.
const today = '2026-10-27';
const tara = '00000000-0000-4000-8000-00000000000b';
const calls = targetValue('course', 'course-calls');
const ready: AssignDraft = { ...emptyDraft, target: calls, people: [tara] };

describe('requestFrom', () => {
  it('makes the request for a course or a path, with the due date chosen', () => {
    const draft: AssignDraft = {
      ...ready,
      groups: ['group-front-desk'],
      due: 'date',
      dueDate: '2026-11-06',
      dueInDays: '14',
    };
    expect(requestFrom(draft, today)).toEqual({
      request: {
        target: { type: 'course', id: 'course-calls' },
        people: [tara],
        groups: ['group-front-desk'],
        dueDate: '2026-11-06',
        required: true,
      },
    });
    const path: AssignDraft = {
      ...emptyDraft,
      target: targetValue('path', 'path-new-starters'),
      groups: ['group-front-desk'],
      due: 'days',
      dueInDays: ' 14 ',
      required: false,
    };
    expect(requestFrom(path, today)).toEqual({
      request: {
        target: { type: 'path', id: 'path-new-starters' },
        people: [],
        groups: ['group-front-desk'],
        dueInDays: 14,
        required: false,
      },
    });
    expect(requestFrom({ ...draft, due: 'none' }, today)).toEqual({
      request: {
        target: { type: 'course', id: 'course-calls' },
        people: [tara],
        groups: ['group-front-desk'],
        required: true,
      },
    });
    expect(requestFrom({ ...ready, due: 'date', dueDate: today }, today)).toHaveProperty('request');
  });

  it('says what to fix, field by field', () => {
    expect(requestFrom(emptyDraft, today)).toEqual({
      errors: { target: 'Choose a course or path.', who: 'Choose at least one person or group.' },
    });
    for (const target of ['course:', 'page:home', 'course-calls']) {
      expect(requestFrom({ ...ready, target }, today)).toEqual({
        errors: { target: 'Choose a course or path.' },
      });
    }
    expect(requestFrom({ ...ready, due: 'date' }, today)).toEqual({
      errors: { dueDate: 'Choose a due date.' },
    });
    expect(requestFrom({ ...ready, due: 'date', dueDate: '2026-10-26' }, today)).toEqual({
      errors: { dueDate: 'Choose today or a later day.' },
    });
    for (const dueInDays of ['', '0', '1.5', '-2', '3651', 'ten']) {
      expect(requestFrom({ ...ready, due: 'days', dueInDays }, today)).toEqual({
        errors: { dueInDays: 'Enter a whole number of days from 1 to 3650.' },
      });
    }
    const crowd = Array.from({ length: 501 }, (_, index) => `person-${index}`);
    expect(requestFrom({ ...ready, people: crowd }, today)).toEqual({
      errors: { who: 'Choose at most 500 people at a time.' },
    });
  });
});

describe('errorsFromIssues', () => {
  it("puts the server's messages at their fields, the first one for each", () => {
    const issues = [
      { path: 'dueDate', message: 'Choose today or a later day.' },
      { path: 'people[0]', message: 'Choose people from the workspace.' },
      { path: 'groups', message: 'Choose at most 100 groups.' },
      { path: '', message: 'None of the courses on this path is published yet.' },
    ];
    expect(errorsFromIssues(issues)).toEqual({
      errors: { dueDate: 'Choose today or a later day.', who: 'Choose people from the workspace.' },
      other: ['None of the courses on this path is published yet.'],
    });
  });
});

describe('the words and choices of the form', () => {
  it('counts people and groups, and knows the day on this device', () => {
    expect(countText(1, 0)).toBe('1 person');
    expect(countText(3, 1)).toBe('3 people and 1 group');
    expect(countText(0, 2)).toBe('2 groups');
    expect(countText(0, 0)).toBe('no one');
    expect(localToday(new Date(2026, 9, 7, 23, 30))).toBe('2026-10-07');
  });

  it('finds people by any part of their name or email, accents and case aside', () => {
    const people = [
      { name: 'Tara Lopez', email: 'tara@example.org' },
      { name: 'Zoë Brennan', email: 'zoe@example.org' },
      { name: 'Omar Haddad' },
    ];
    expect(findPeople(people, 'zoe').map((person) => person.name)).toEqual(['Zoë Brennan']);
    expect(findPeople(people, 'EXAMPLE lop').map((person) => person.name)).toEqual(['Tara Lopez']);
    expect(findPeople(people, '  ')).toEqual(people);
    expect(findPeople(people, 'nobody')).toEqual([]);
  });

  it('offers published courses: the catalog, and the rest for people who build', () => {
    const catalog = [{ id: 'course-calls', title: 'Handling calls with care' }];
    const studio = [
      {
        id: 'course-calls',
        title: 'Calls (new draft)',
        state: 'changed',
        archived: false,
        listed: true,
      },
      {
        id: 'course-privacy',
        title: 'Privacy basics',
        state: 'live',
        archived: false,
        listed: false,
      },
      { id: 'course-new', title: 'A new course', state: 'draft', archived: false, listed: false },
      { id: 'course-old', title: 'An old course', state: 'live', archived: true, listed: true },
    ] as const;
    expect(courseOptions(catalog, studio)).toEqual([
      { id: 'course-calls', title: 'Handling calls with care', listed: true },
      { id: 'course-privacy', title: 'Privacy basics', listed: false },
    ]);
    expect(courseOptions(catalog, null)).toEqual([
      { id: 'course-calls', title: 'Handling calls with care', listed: true },
    ]);
  });
});
