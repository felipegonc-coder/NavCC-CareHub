import { describe, expect, it } from 'vitest';
import { defaultForm } from '../schema';
import type { FormDefinition } from '../types';
import {
  anonymousLine,
  formChangeNeedsFullAccess,
  formGate,
  responseNotice,
  responseRateLimit,
  type FormVisit,
} from './gate';

const form = (over: Partial<FormDefinition> = {}): FormDefinition => ({
  ...defaultForm('QA dispute request', []),
  linkCode: 'code-1',
  ...over,
});
const visit = (over: Partial<FormVisit> = {}): FormVisit => ({
  linkCode: 'code-1',
  visitor: 'member',
  canEdit: false,
  inTrash: false,
  responseCount: 0,
  respondedAt: null,
  workspaceName: 'Northwind Care',
  now: new Date('2026-10-27T18:00:00Z'),
  timeZone: 'America/Denver',
  ...over,
});
const open = { state: 'open', message: null };
const notAccepting = { state: 'not_accepting', message: "This form isn't accepting responses." };

describe('formGate', () => {
  it('opens an accepting form for a member with the current link', () => {
    expect(formGate(form(), visit())).toEqual(open);
    expect(formGate(form(), visit({ linkCode: null }))).toEqual(open);
  });
  it('shows the right screen for responses off, a changed link, signed out and non-members (FM-08)', () => {
    expect(formGate(form({ accepting: false }), visit())).toEqual(notAccepting);
    expect(formGate(form(), visit({ inTrash: true }))).toEqual(notAccepting);
    expect(formGate(form(), visit({ linkCode: 'old-code' }))).toEqual({
      state: 'link_changed',
      message: 'This form link has changed. Ask the person who sent it for the new one.',
    });
    expect(formGate(form(), visit({ visitor: 'signed_out' }))).toEqual({
      state: 'sign_in',
      message: null,
    });
    expect(formGate(form(), visit({ visitor: 'guest' }))).toEqual({
      state: 'not_member',
      message: 'This form is only for members of Northwind Care.',
    });
  });
  it('lets guests in only when the form allows guests (FM-19)', () => {
    const guests = form({ audience: 'members_and_guests' });
    expect(formGate(guests, visit({ visitor: 'guest' }))).toEqual(open);
    expect(formGate(guests, visit({ visitor: 'signed_out' })).state).toBe('sign_in');
  });
  it('opens a form anyone can fill in without signing in (FM-18)', () => {
    const anyone = form({ audience: 'anyone', allowMultiple: false });
    expect(formGate(anyone, visit({ visitor: 'signed_out' }))).toEqual(open);
    expect(formGate(anyone, visit({ visitor: 'guest' }))).toEqual(open);
    expect(formGate(anyone, visit({ visitor: 'signed_out', linkCode: 'old' })).state).toBe(
      'link_changed',
    );
  });
  it('closes at the close time and after the maximum number of responses (FM-20)', () => {
    const closeAt = '2026-10-31T05:00:00Z';
    expect(formGate(form({ closeAt }), visit())).toEqual(open);
    expect(formGate(form({ closeAt }), visit({ now: new Date(closeAt) }))).toEqual({
      state: 'closed',
      message: 'This form closed on Oct 30, 2026.',
    });
    expect(
      formGate(form({ closeAt }), visit({ now: new Date(closeAt), timeZone: 'Europe/Lisbon' }))
        .message,
    ).toBe('This form closed on Oct 31, 2026.');
    const full = { state: 'closed', message: "This form isn't taking more responses." };
    expect(formGate(form({ maxResponses: 50 }), visit({ responseCount: 49 }))).toEqual(open);
    expect(formGate(form({ maxResponses: 50 }), visit({ responseCount: 50 }))).toEqual(full);
    expect(formGate(form({ closeAt: null, maxResponses: null }), visit())).toEqual(open);
  });
  it('lets people with Can edit test in the Form view, but not through the link', () => {
    const closed = form({ accepting: false, maxResponses: 1 });
    const editor = { canEdit: true, visitor: 'guest' } as const;
    expect(formGate(closed, visit({ ...editor, linkCode: null }))).toEqual(open);
    expect(formGate(closed, visit({ ...editor, linkCode: 'code-1' })).state).toBe('not_member');
    expect(formGate(closed, visit({ canEdit: true }))).toEqual(notAccepting);
    expect(formGate(closed, visit({ canEdit: true, linkCode: null, inTrash: true }))).toEqual(
      notAccepting,
    );
  });
  it('shows "You already responded…" when only one response is allowed (FM-13)', () => {
    const once = form({ allowMultiple: false });
    const respondedAt = '2026-10-27T03:00:00Z';
    expect(formGate(once, visit({ respondedAt }))).toEqual({
      state: 'already_responded',
      message: 'You already responded on Oct 26, 2026.',
    });
    expect(formGate(once, visit())).toEqual(open);
    expect(formGate(form(), visit({ respondedAt }))).toEqual(open);
    expect(formGate({ ...once, anonymous: true }, visit({ respondedAt }))).toEqual(open);
  });
});

describe('responseRateLimit', () => {
  it('allows 10 a minute per person, or 30 a minute in total when anyone can respond', () => {
    const message = 'Too many responses. Try again in a minute.';
    expect(responseRateLimit(form())).toEqual({ per: 'person', perMinute: 10, message });
    expect(responseRateLimit(form({ anonymous: true }))).toEqual({
      per: 'person',
      perMinute: 10,
      message,
    });
    expect(responseRateLimit(form({ audience: 'anyone' }))).toEqual({
      per: 'form',
      perMinute: 30,
      message,
    });
  });
});

describe('formChangeNeedsFullAccess', () => {
  const before = form();
  it('needs Full access for anonymous, who can respond, closing, responses and the link', () => {
    for (const change of [
      { anonymous: true },
      { audience: 'anyone' },
      { closeAt: '2026-10-31T05:00:00Z' },
      { maxResponses: 50 },
      { accepting: false },
      { linkCode: 'code-2' },
    ] as const) {
      expect(formChangeNeedsFullAccess(before, { ...before, ...change })).toBe(true);
    }
  });
  it('leaves other changes to Can edit', () => {
    expect(formChangeNeedsFullAccess(before, { ...before, title: 'Coaching feedback' })).toBe(
      false,
    );
    expect(formChangeNeedsFullAccess(before, { ...before, allowMultiple: false })).toBe(false);
    expect(formChangeNeedsFullAccess(before, { ...before, audience: 'members' })).toBe(false);
    expect(formChangeNeedsFullAccess(before, { ...before, closeAt: null })).toBe(false);
  });
});

describe('anonymous texts', () => {
  it('tells respondents their name is not recorded (FM-17)', () => {
    expect(anonymousLine(form({ anonymous: true }))).toBe(
      "Your name isn't recorded with this form.",
    );
    expect(anonymousLine(form({ audience: 'anyone' }))).toBe(
      "Your name isn't recorded with this form.",
    );
    expect(anonymousLine(form())).toBeNull();
  });
  it('words notices without naming anyone', () => {
    expect(responseNotice('QA dispute request', 1, true)).toBe(
      "New anonymous response to 'QA dispute request'",
    );
    expect(responseNotice('QA dispute request', 1, false)).toBe(
      "New response to 'QA dispute request'",
    );
    expect(responseNotice('QA dispute request', 3, true)).toBe(
      "3 new responses to 'QA dispute request'",
    );
  });
});
