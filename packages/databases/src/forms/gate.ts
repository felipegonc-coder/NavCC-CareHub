/**
 * When a form opens and takes responses (Forms spec v2, sections 2, 3 and 5): the fill screen's
 * states with their words, the response rate limits, the settings only Full access can change,
 * and the texts for anonymous forms. The server checks all of it again on every submit.
 */
import { DEFAULT_TIME_ZONE, formatCalendarDate, instantToCalendarDate, isInstant } from '../dates';
import { LIMITS } from '../types';
import type { FormDefinition, Instant } from '../types';
import { formAudience, isAnonymousForm } from './questions';

/**
 * What opening the form shows. 'open': the form. 'sign_in': the sign-in screen, then straight back
 * to the form. Any other state shows its message instead of the form, and a submit is refused.
 */
export type FormGate =
  | { state: 'open' | 'sign_in'; message: null }
  | {
      state: 'link_changed' | 'not_member' | 'not_accepting' | 'closed' | 'already_responded';
      message: string;
    };

/** Who is opening the form, how, and what the server knows right now. */
export interface FormVisit {
  /** The code in the link that was opened, or null for the Form view inside the database. */
  linkCode: string | null;
  /** 'signed_out' when nobody is signed in. */
  visitor: 'member' | 'guest' | 'signed_out';
  /** Can edit on the database: in the Form view they can still submit while responses are off or closed, for testing. */
  canEdit: boolean;
  /** The database is in Trash. */
  inTrash: boolean;
  /** How many responses the form has. */
  responseCount: number;
  /** When this person last responded with this form; only known when the form records senders. */
  respondedAt: Instant | null;
  /** For "This form is only for members of Northwind Care." */
  workspaceName: string;
  now: Date;
  /** Time zone for the dates in messages; default America/Denver. */
  timeZone?: string;
}

const NOT_ACCEPTING = "This form isn't accepting responses.";

const fullDate = (instant: Instant, timeZone: string): string =>
  formatCalendarDate(instantToCalendarDate(instant, timeZone), 'full');

/**
 * What the form link or Form view shows, checked in this order: a changed link; the sign-in
 * screen (not needed when anyone can fill the form in); the Trash; then, except for someone with
 * Can edit testing in the Form view: who can respond, responses off, the close date and the
 * maximum number of responses; last, "You already responded on Oct 26, 2026." when only one
 * response is allowed.
 */
export function formGate(def: FormDefinition, visit: FormVisit): FormGate {
  if (visit.linkCode !== null && visit.linkCode !== def.linkCode) {
    return {
      state: 'link_changed',
      message: 'This form link has changed. Ask the person who sent it for the new one.',
    };
  }
  const audience = formAudience(def);
  if (audience !== 'anyone' && visit.visitor === 'signed_out') {
    return { state: 'sign_in', message: null };
  }
  if (visit.inTrash) return { state: 'not_accepting', message: NOT_ACCEPTING };
  const timeZone = visit.timeZone ?? DEFAULT_TIME_ZONE;
  const testing = visit.linkCode === null && visit.canEdit;
  if (!testing) {
    if (audience === 'members' && visit.visitor !== 'member') {
      return {
        state: 'not_member',
        message: `This form is only for members of ${visit.workspaceName}.`,
      };
    }
    if (!def.accepting) return { state: 'not_accepting', message: NOT_ACCEPTING };
    const closeAt = def.closeAt;
    if (isInstant(closeAt) && visit.now.getTime() >= Date.parse(closeAt)) {
      return { state: 'closed', message: `This form closed on ${fullDate(closeAt, timeZone)}.` };
    }
    const max = def.maxResponses;
    if (typeof max === 'number' && visit.responseCount >= max) {
      return { state: 'closed', message: "This form isn't taking more responses." };
    }
  }
  if (!def.allowMultiple && !isAnonymousForm(def) && visit.respondedAt !== null) {
    return {
      state: 'already_responded',
      message: `You already responded on ${fullDate(visit.respondedAt, timeZone)}.`,
    };
  }
  return { state: 'open', message: null };
}

/**
 * How the server limits responses: 10 a minute per person, or 30 a minute from everyone together
 * for a form anyone can fill in. The counters stay in memory only.
 */
export function responseRateLimit(def: FormDefinition): {
  per: 'person' | 'form';
  perMinute: number;
  message: string;
} {
  const message = 'Too many responses. Try again in a minute.';
  return formAudience(def) === 'anyone'
    ? { per: 'form', perMinute: LIMITS.formAnyoneResponsesPerMinute, message }
    : { per: 'person', perMinute: LIMITS.formResponsesPerMinute, message };
}

/**
 * True when a change to the form needs Full access on the database (Forms spec 5): responses on
 * or off, the link, Anonymous responses, who can respond, and closing (close date or maximum
 * responses). Other changes need Can edit with Lock structure off.
 */
export function formChangeNeedsFullAccess(before: FormDefinition, after: FormDefinition): boolean {
  return (
    before.accepting !== after.accepting ||
    before.linkCode !== after.linkCode ||
    before.anonymous !== after.anonymous ||
    formAudience(before) !== formAudience(after) ||
    (before.closeAt ?? null) !== (after.closeAt ?? null) ||
    (before.maxResponses ?? null) !== (after.maxResponses ?? null)
  );
}

/** The line under the title on an anonymous form's fill screen, or null. */
export function anonymousLine(def: FormDefinition): string | null {
  return isAnonymousForm(def) ? "Your name isn't recorded with this form." : null;
}

/**
 * The notice about new responses; it never names anyone. One response: "New anonymous response to
 * 'QA dispute request'" (or "New response to 'QA dispute request'" when it records its sender).
 * A group: "3 new responses to 'QA dispute request'".
 */
export function responseNotice(formName: string, count: number, anonymous: boolean): string {
  if (count > 1) return `${count} new responses to '${formName}'`;
  return anonymous ? `New anonymous response to '${formName}'` : `New response to '${formName}'`;
}
