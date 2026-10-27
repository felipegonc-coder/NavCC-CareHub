/**
 * What an automation is made of (Automations spec, sections 3 and 4), shared by the server and
 * the web app. Triggers and actions are stored as JSON, so new kinds need no migration. This set
 * is the basic slice: a schedule, Row added and Form response, then Send a message and Add a row.
 * The rest of AU-D2 (Property changed, Date arrives, Edit the row…) adds to these unions later.
 */
import type { Schedule } from './schedule';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Up to this many automations per workspace (spec, Running: Limits). */
export const MAX_AUTOMATIONS = 50;
/** Each automation keeps this many of its latest runs, with their steps. */
export const RUNS_KEPT = 100;
/** The editor's limits (spec, sections 2 and 3). */
export const LIMITS = {
  name: 100,
  actions: 10,
  variables: 10,
  /** People picked one by one; roles and everyone are worked out (up to 500) when it runs. */
  recipients: 500,
  text: 2_000,
  pageCards: 3,
  formula: 2_000,
} as const;

/** What starts an automation: one per automation. */
export type Trigger =
  | { kind: 'schedule'; schedule: Schedule }
  | {
      kind: 'rowAdded';
      databaseId: string;
      /** Rows from a CSV import count only when this is on (off by default). */
      includeImports: boolean;
    }
  | { kind: 'formResponse'; databaseId: string; formId: string };

export type TriggerKind = Trigger['kind'];

/** Who gets a message. Roles, everyone and Person properties are worked out when it runs. */
export type Recipient =
  | { kind: 'person'; userId: string }
  | { kind: 'role'; roleId: string }
  | { kind: 'everyone' }
  | { kind: 'personProperty'; propertyId: string };

/** Where a value comes from when an action sets a property. */
export type ValueSource =
  | { kind: 'value'; value: Json }
  | { kind: 'now' }
  | { kind: 'today' }
  /** The person who made the change, or the form's respondent. */
  | { kind: 'triggeredBy' }
  /** A property of the row that fired it. */
  | { kind: 'rowProperty'; propertyId: string }
  | { kind: 'formula'; formula: string };

export interface PropertyValue {
  propertyId: string;
  value: ValueSource;
}

/** Up to 10 per automation, run in order; a failed step stops the ones after it. */
export type Action =
  | {
      kind: 'sendMessage';
      recipients: Recipient[];
      /** Up to 2,000 characters with bold, italic, links and fill-ins such as {first name}. */
      text: string;
      /** Up to 3 page cards, each shown only to recipients who can open the page. */
      pageIds: string[];
    }
  | {
      kind: 'addRow';
      databaseId: string;
      /** One of that database's templates, or none. */
      templateId: string | null;
      values: PropertyValue[];
    };

export type ActionKind = Action['kind'];

/** A named value worked out with a formula before the actions run. */
export interface Variable {
  name: string;
  formula: string;
}

/** Scheduled, Try it now's "Send only to me" (test), "Send to everyone now" (manual), or a database trigger. */
export type RunKind = 'scheduled' | 'test' | 'manual' | 'triggered';
export type RunResult = 'sent' | 'failed' | 'skipped' | 'missed';

export interface RunStep {
  /** The action's place in the list, from 0. */
  action: number;
  kind: ActionKind;
  result: 'done' | 'failed' | 'skipped';
  /** What it did or why it failed, in plain words. */
  message: string | null;
}

/** The row, and the form response, that fired a database trigger. */
export interface RunSource {
  databaseId: string;
  rowId: string;
  responseId?: string;
}

/** Every database the trigger and actions use: the list's database filter. */
export function databasesUsed(trigger: Trigger, actions: readonly Action[]): string[] {
  const ids = new Set<string>();
  if (trigger.kind !== 'schedule') ids.add(trigger.databaseId);
  for (const action of actions) if (action.kind === 'addRow') ids.add(action.databaseId);
  return [...ids];
}
