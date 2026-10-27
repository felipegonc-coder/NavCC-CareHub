/**
 * What the editor may save (Automations spec, sections 2 and 3). The zod schemas check the shape;
 * `automationProblems` checks the rules and words each save error for its field, such as "Pick at
 * least one recipient." on `actions.0.recipients`.
 */
import { z } from 'zod';
import { LIMITS, type Action, type Json, type Trigger, type Variable } from './automation';
import { scheduleProblems } from './schedule';

/** Another feature's ID (a database, form, page, role or property). */
const ref = z.string().min(1).max(200);
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
// Values are checked by scheduleProblems, which words the errors.
const time = z.string().max(5);
const date = z.string().max(10);
const timeZone = z.string().max(100);
const endDate = date.nullable();

const schedule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date, time, timeZone }),
  z.object({ kind: z.literal('daily'), time, timeZone, endDate }),
  z.object({ kind: z.literal('weekdays'), time, timeZone, endDate }),
  z.object({
    kind: z.literal('weekly'),
    days: z.array(z.literal([0, 1, 2, 3, 4, 5, 6])).max(7),
    time,
    timeZone,
    endDate,
  }),
  z.object({
    kind: z.literal('monthly'),
    dayOfMonth: z.union([z.number().int(), z.literal('last')]),
    time,
    timeZone,
    endDate,
  }),
]);

// Typed with the shapes in automation.ts, so the schemas can't drift from them.
const trigger: z.ZodType<Trigger> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule'), schedule }),
  z.object({ kind: z.literal('rowAdded'), databaseId: ref, includeImports: z.boolean() }),
  z.object({ kind: z.literal('formResponse'), databaseId: ref, formId: ref }),
]);

const recipient = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), userId: z.guid() }),
  z.object({ kind: z.literal('role'), roleId: ref }),
  z.object({ kind: z.literal('everyone') }),
  z.object({ kind: z.literal('personProperty'), propertyId: ref }),
]);

const valueSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), value: json }),
  z.object({ kind: z.literal('now') }),
  z.object({ kind: z.literal('today') }),
  z.object({ kind: z.literal('triggeredBy') }),
  z.object({ kind: z.literal('rowProperty'), propertyId: ref }),
  z.object({ kind: z.literal('formula'), formula: z.string().max(LIMITS.formula) }),
]);

const action: z.ZodType<Action> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sendMessage'),
    recipients: z.array(recipient).max(LIMITS.recipients, 'Pick up to 500 recipients.'),
    text: z.string().max(LIMITS.text, 'Keep the message under 2,000 characters.'),
    pageIds: z.array(ref).max(LIMITS.pageCards, 'Add up to 3 page cards.'),
  }),
  z.object({
    kind: z.literal('addRow'),
    databaseId: ref,
    templateId: ref.nullable(),
    values: z.array(z.object({ propertyId: ref, value: valueSource })).max(200),
  }),
]);

const variable: z.ZodType<Variable> = z.object({
  name: z.string().trim().min(1, 'Give the variable a name.').max(50),
  formula: z.string().max(LIMITS.formula),
});

const settings = {
  name: z
    .string()
    .trim()
    .min(1, 'Give it a name.')
    .max(LIMITS.name, 'Keep the name under 100 characters.'),
  enabled: z.boolean(),
  trigger,
  conditions: json.nullable(),
  variables: z.array(variable).max(LIMITS.variables, 'Add up to 10 variables.'),
  actions: z
    .array(action)
    .min(1, 'Add at least one action.')
    .max(LIMITS.actions, 'Add up to 10 actions.'),
};

/** POST /api/automations. */
export const automationInput = z.object({
  ...settings,
  enabled: settings.enabled.default(true),
  conditions: settings.conditions.default(null),
  variables: settings.variables.default([]),
});
export type AutomationInput = z.infer<typeof automationInput>;

/** PATCH /api/automations/:id: only the fields that change. */
export const automationChanges = z.object({
  name: settings.name.optional(),
  enabled: settings.enabled.optional(),
  trigger: settings.trigger.optional(),
  conditions: settings.conditions.optional(),
  variables: settings.variables.optional(),
  actions: settings.actions.optional(),
});

/** GET /api/automations: the list's filters, from the query string. */
export const automationListQuery = z.object({
  databaseId: ref.optional(),
  ownerUserId: z.guid().optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/** POST /api/automations/:id/try: Send only to me (`me`, the default) or Send to everyone now. */
export const tryNowInput = z.object({ to: z.enum(['me', 'everyone']).default('me') });
export type TryNowInput = z.input<typeof tryNowInput>;

export interface Problem {
  path: (string | number)[];
  message: string;
}

interface Checked {
  enabled: boolean;
  trigger: Trigger;
  conditions: Json | null;
  variables: Variable[];
  actions: Action[];
}

/**
 * The save errors for an automation, each naming its field. A schedule whose time has passed is
 * an error only when the automation is on, so an old Once automation can still be renamed.
 */
export function automationProblems(automation: Checked, now: Date): Problem[] {
  const problems: Problem[] = [];
  const add = (path: (string | number)[], message: string) => problems.push({ path, message });
  const { trigger } = automation;
  const fromDatabase = trigger.kind !== 'schedule';
  if (trigger.kind === 'schedule') {
    for (const { field, message } of scheduleProblems(trigger.schedule, now)) {
      const passed = message.includes('already passed') || message.startsWith('No runs are left');
      if (automation.enabled || !passed) add(['trigger', 'schedule', field], message);
    }
  }
  if (automation.conditions !== null && !fromDatabase) {
    add(['conditions'], 'Conditions need a database trigger.');
  }
  const names = automation.variables.map((v) => v.name.toLowerCase());
  names.forEach((name, i) => {
    if (names.indexOf(name) !== i)
      add(['variables', i, 'name'], 'Each variable needs its own name.');
  });
  automation.actions.forEach((action, i) => {
    if (action.kind === 'sendMessage') {
      if (action.recipients.length === 0)
        add(['actions', i, 'recipients'], 'Pick at least one recipient.');
      if (!fromDatabase && action.recipients.some((r) => r.kind === 'personProperty')) {
        add(['actions', i, 'recipients'], 'A Person property needs a database trigger.');
      }
      if (action.text.trim() === '' && action.pageIds.length === 0) {
        add(['actions', i, 'text'], 'Write a message.');
      }
    } else if (!fromDatabase) {
      action.values.forEach(({ value }, j) => {
        if (value.kind === 'rowProperty' || value.kind === 'triggeredBy') {
          add(['actions', i, 'values', j, 'value'], 'This value needs a database trigger.');
        }
      });
    }
  });
  return problems;
}
