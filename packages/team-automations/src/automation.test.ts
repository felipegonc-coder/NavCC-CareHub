import { describe, expect, it } from 'vitest';
import { newRowFires, type ChangeSource, type Trigger } from './automation';

const qaReviews = 'db-qa-reviews';
const rowAdded: Trigger = { kind: 'rowAdded', databaseId: qaReviews, includeImports: false };
const withImports: Trigger = { ...rowAdded, includeImports: true };
const formResponse: Trigger = { kind: 'formResponse', databaseId: qaReviews, formId: 'form-1' };
const people: ChangeSource[] = ['user', 'form', 'template', 'button'];

describe('newRowFires', () => {
  it('never fires for rows added by automations, so they cannot loop', () => {
    for (const trigger of [rowAdded, withImports, formResponse]) {
      const row = { databaseId: qaReviews, source: 'automation' as const, formId: 'form-1' };
      expect(newRowFires(trigger, row)).toBe(false);
    }
  });

  it('fires Row added for rows from people, forms, templates and buttons (AU-12)', () => {
    for (const source of people) {
      expect(newRowFires(rowAdded, { databaseId: qaReviews, source })).toBe(true);
    }
    expect(newRowFires(rowAdded, { databaseId: 'db-tickets', source: 'user' })).toBe(false);
  });

  it('counts CSV imports only with Include imports on (AU-12)', () => {
    const imported = { databaseId: qaReviews, source: 'import' as const };
    expect(newRowFires(rowAdded, imported)).toBe(false);
    expect(newRowFires(withImports, imported)).toBe(true);
  });

  it('fires Form response only for responses through its form', () => {
    const response = { databaseId: qaReviews, source: 'form' as const, formId: 'form-1' };
    expect(newRowFires(formResponse, response)).toBe(true);
    expect(newRowFires(formResponse, { ...response, formId: 'form-2' })).toBe(false);
    expect(newRowFires(formResponse, { databaseId: qaReviews, source: 'user' })).toBe(false);
  });

  it('never fires a schedule', () => {
    const schedule: Trigger = {
      kind: 'schedule',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'America/Denver', endDate: null },
    };
    expect(newRowFires(schedule, { databaseId: qaReviews, source: 'user' })).toBe(false);
  });
});
