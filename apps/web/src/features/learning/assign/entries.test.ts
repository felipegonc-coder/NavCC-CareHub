import type { Assignment } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { formatDay, formatDueDate } from '../home/entry';
import {
  byText,
  dueText,
  entriesOf,
  listText,
  RECERTIFICATION_ASSIGNER,
  titleOf,
  whoText,
  type Names,
} from './entries';

// Fictional people and courses only.
const person = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [trainer, tara, omar, priya, eli, casey] = [1, 2, 3, 4, 5, 6].map(person);
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (hour: number) => `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z`;

const row = (n: number, change: Partial<Assignment> = {}): Assignment => ({
  id: id(n),
  courseId: 'course-calls',
  courseTitle: 'Handling calls with care',
  pathId: null,
  people: [tara],
  groups: [],
  dueDate: null,
  dueInDays: null,
  required: true,
  createdBy: trainer,
  createdAt: at(9),
  ...change,
});

const names: Names = {
  people: new Map([
    [trainer, 'Sam Trainer'],
    [tara, 'Tara Lopez'],
    [omar, 'Omar Haddad'],
    [priya, 'Priya Shah'],
    [eli, 'Eli Brooks'],
    [casey, 'Casey Moore'],
  ]),
  groups: new Map([['group-front-desk', 'Front desk']]),
};

describe('entriesOf', () => {
  it("keeps each path assignment's courses together, newest first", () => {
    const path = { pathId: 'path-new-starters', createdAt: at(10) };
    const rows = [
      row(1),
      row(2, { ...path, courseId: 'course-hold', courseTitle: 'Putting a call on hold' }),
      row(3, { ...path, courseId: 'course-privacy', courseTitle: 'Privacy basics' }),
      row(4, { ...path, createdAt: at(11), courseId: 'course-hold' }),
      row(5, { ...path, createdBy: omar, courseId: 'course-hold' }),
      row(6, { createdAt: at(12) }),
    ];
    const entries = entriesOf(rows);
    expect(entries.map((entry) => [entry.id, entry.rows.length])).toEqual([
      [id(6), 1],
      [id(5), 1],
      [id(4), 1],
      [id(2), 2],
      [id(1), 1],
    ]);
    const titles = new Map([['path-new-starters', 'New starters']]);
    expect(entries.map((entry) => titleOf(entry, titles))).toEqual([
      'Handling calls with care',
      'New starters',
      'New starters',
      'New starters',
      'Handling calls with care',
    ]);
    const [, , , pathEntry] = entries;
    expect(pathEntry && titleOf(pathEntry, new Map())).toBe('A learning path');
    const [gone] = entriesOf([row(7, { courseTitle: null })]);
    expect(gone && titleOf(gone, titles)).toBe('A course that is no longer published');
  });
});

describe('what an entry says', () => {
  it('names up to three people and groups, then counts the rest', () => {
    expect(whoText({ people: [tara], groups: [] }, names)).toBe('Tara Lopez');
    expect(whoText({ people: [tara], groups: ['group-front-desk'] }, names)).toBe(
      'Tara Lopez and Front desk (group)',
    );
    const many = { people: [tara, omar, priya, eli, casey], groups: ['group-front-desk'] };
    expect(whoText(many, names)).toBe('Tara Lopez, Omar Haddad, Priya Shah and 3 more');
    expect(whoText({ people: [tara, person(99)], groups: ['group-gone'] }, names)).toBe(
      'Tara Lopez, 1 former member and 1 removed group',
    );
    expect(whoText({ people: [person(98), person(99)], groups: [] }, names)).toBe(
      '2 former members',
    );
    expect(whoText({ people: [tara], groups: ['a', 'b'] }, { ...names, groups: null })).toBe(
      'Tara Lopez and 2 groups',
    );
    expect(whoText(many, { people: null, groups: null })).toBe('5 people and 1 group');
    expect(listText([])).toBe('');
    expect(listText(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('says when it is due, and who assigned it', () => {
    expect(dueText({ dueDate: '2026-11-06', dueInDays: null })).toBe(
      `Due ${formatDueDate('2026-11-06')}`,
    );
    expect(dueText({ dueDate: null, dueInDays: 1 })).toBe("Due 1 day after it's assigned");
    expect(dueText({ dueDate: null, dueInDays: 14 })).toBe("Due 14 days after it's assigned");
    expect(dueText({ dueDate: null, dueInDays: null })).toBe('No due date');

    const made = { createdBy: trainer, createdAt: at(9) };
    expect(byText(made, names.people)).toBe(`Assigned by Sam Trainer on ${formatDay(at(9))}`);
    expect(byText({ ...made, createdBy: person(99) }, names.people)).toBe(
      `Assigned by a former member on ${formatDay(at(9))}`,
    );
    expect(byText(made, null)).toBe(`Assigned by someone in this workspace on ${formatDay(at(9))}`);
    expect(byText({ ...made, createdBy: RECERTIFICATION_ASSIGNER }, names.people)).toBe(
      'Assigned by Care Hub for re-certification',
    );
  });
});
