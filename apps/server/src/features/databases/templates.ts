// Database templates (decision 0200; Templates and buttons spec 3.2): adding, changing and deleting
// a database's row templates. Pure: template-routes.ts checks access, makes and removes the
// template's page and saves the settings; these say what the templates become, or refuse with the
// package's messages. Presets are checked like cells (validateValue) and saved the way cells are.
import { isDeepStrictEqual } from 'node:util';
import {
  LIMITS,
  ME,
  THIS_PAGE,
  findProperty,
  uniqueViewName,
  type Id,
  type RepeatSchedule,
  type RowTemplate,
  type View,
} from '@carehub/databases';
import { validateSchedule } from '@carehub/databases/repeat';
import { TEMPLATE_MESSAGES, isDynamicDate, validateTemplate } from '@carehub/databases/templates';
import { validateValue } from '@carehub/databases/values';
import { invalid, notFound } from './errors';
import type { DatabaseRecord } from './record';

/** The name of a template made without one, numbered when taken ("New template 2"). */
export const NEW_TEMPLATE_NAME = 'New template';

/** Who is changing templates: the person, and the properties they can't see. */
export interface TemplateEditor {
  userId: Id;
  hidden: ReadonlySet<Id>;
}

export interface TemplateInput {
  name?: string | undefined;
  icon?: string | null | undefined;
  values?: Partial<Record<Id, unknown>> | undefined;
  repeat?: RepeatSchedule | null | undefined;
}

/** A preset as it's saved: Today, Now, Me and This page as sent, anything else as a cell. */
function savedPreset(record: DatabaseRecord, id: Id, raw: unknown): unknown {
  const prop = findProperty(record.properties, id);
  if (!prop || isDynamicDate(raw)) return raw;
  if (Array.isArray(raw) && (raw.includes(ME) || raw.includes(THIS_PAGE))) return raw;
  const result = validateValue(prop, raw);
  return result.ok ? result.value : raw;
}

/**
 * Sent presets checked and saved like cells, with the saved presets of properties `kept` says to
 * keep (ones the person can't see, and deleted ones). A preset on a property the person can't see
 * is refused like one on a property that doesn't exist.
 */
function presets(
  record: DatabaseRecord,
  template: RowTemplate,
  sent: Partial<Record<Id, unknown>>,
  editor: TemplateEditor,
): Partial<Record<Id, unknown>> {
  const deleted = new Set(record.deletedProperties.map((d) => d.property.id));
  const kept = (id: Id) => editor.hidden.has(id) || deleted.has(id);
  if (Object.keys(sent).some((id) => kept(id))) throw invalid(TEMPLATE_MESSAGES.noProperty);
  const problem = validateTemplate({ ...template, values: sent }, record.properties, {
    others: record.templates,
    validate: validateValue,
  });
  if (problem) throw invalid(problem);
  const out: Partial<Record<Id, unknown>> = {};
  for (const [id, raw] of Object.entries(sent)) {
    const value = raw === null || raw === undefined ? null : savedPreset(record, id, raw);
    if (value !== null) out[id] = value;
  }
  for (const [id, value] of Object.entries(template.values)) if (kept(id)) out[id] = value;
  return out;
}

/** A schedule as sent, run as `ownerId`; checked with the database's other repeating templates. */
function schedule(
  record: DatabaseRecord,
  templateId: Id,
  repeat: RepeatSchedule,
  ownerId: Id,
): RepeatSchedule {
  const out = { ...repeat, ownerId };
  const problem = validateSchedule(out, { templates: record.templates, templateId });
  if (problem) throw invalid(problem);
  return out;
}

export interface NewTemplatePlan {
  template: RowTemplate;
  templates: RowTemplate[];
}

/** A new template, last; `id` is its page's. A repeat runs as the person who set it up. */
export function planNewTemplate(
  current: DatabaseRecord,
  id: Id,
  input: TemplateInput,
  editor: TemplateEditor,
): NewTemplatePlan {
  if (current.templates.length >= LIMITS.templates) throw invalid(TEMPLATE_MESSAGES.tooMany);
  const names = current.templates.map((t) => t.name);
  const template: RowTemplate = {
    id,
    name: input.name ?? uniqueViewName(NEW_TEMPLATE_NAME, names),
    icon: input.icon ?? null,
    values: {},
  };
  template.values = presets(current, template, input.values ?? {}, editor);
  if (input.repeat) template.repeat = schedule(current, id, input.repeat, editor.userId);
  return { template, templates: [...current.templates, template] };
}

export interface EditTemplatePlan {
  before: RowTemplate;
  template: RowTemplate;
  templates: RowTemplate[];
}

/**
 * Changing a template's name, icon, presets or repeat. Presets the person can't see stay as saved.
 * A changed schedule runs as the person who changed it; one sent back unchanged keeps its owner.
 */
export function planEditTemplate(
  current: DatabaseRecord,
  templateId: Id,
  patch: TemplateInput,
  editor: TemplateEditor,
): EditTemplatePlan {
  const before = current.templates.find((t) => t.id === templateId);
  if (!before) throw notFound();
  const template: RowTemplate = { ...before };
  if (patch.name !== undefined) template.name = patch.name;
  if (patch.icon !== undefined) template.icon = patch.icon;
  if (patch.values !== undefined) {
    template.values = presets(current, template, patch.values, editor);
  }
  if (patch.repeat === null) {
    if (template.repeat) template.repeat = null;
  } else if (patch.repeat !== undefined) {
    const saved = before.repeat;
    const same = saved && isDeepStrictEqual({ ...patch.repeat, ownerId: saved.ownerId }, saved);
    template.repeat = same ? saved : schedule(current, templateId, patch.repeat, editor.userId);
  }
  if (template.name.length > LIMITS.title) throw invalid(TEMPLATE_MESSAGES.nameTooLong);
  return {
    before,
    template,
    templates: current.templates.map((t) => (t.id === templateId ? template : t)),
  };
}

export interface DeleteTemplatePlan {
  template: RowTemplate;
  templates: RowTemplate[];
  /** The database's default, or null when it was this template. */
  defaultTemplateId: Id | null;
  /** Views that used it as their default follow the database's again. */
  views: View[];
}

/** Deleting a template: defaults that pointed at it go back to the database's, or an empty row. */
export function planDeleteTemplate(current: DatabaseRecord, templateId: Id): DeleteTemplatePlan {
  const template = current.templates.find((t) => t.id === templateId);
  if (!template) throw notFound();
  const views = current.views.map((v) => {
    if (v.defaultTemplateId !== templateId) return v;
    const rest = { ...v };
    delete rest.defaultTemplateId;
    return rest;
  });
  return {
    template,
    templates: current.templates.filter((t) => t.id !== templateId),
    defaultTemplateId: current.defaultTemplateId === templateId ? null : current.defaultTemplateId,
    views,
  };
}

/**
 * "Set as default for all views": the database's default, and every view follows it (views'
 * own defaults, an empty row included, are cleared).
 */
export function followDatabaseDefault(views: readonly View[]): View[] {
  return views.map((v) => {
    if (v.defaultTemplateId === undefined) return v;
    const rest = { ...v };
    delete rest.defaultTemplateId;
    return rest;
  });
}
