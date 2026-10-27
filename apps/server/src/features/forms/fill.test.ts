// The fill screen's form, link codes and the gate's inputs, without a database (Forms spec,
// sections 2 and 3). Fictional people only.
import {
  defaultConfig,
  defaultView,
  newDatabaseSchema,
  newId,
  newProperty,
  relationConfig,
  type FormDefinition,
  type FormQuestion,
  type Property,
} from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import type { DatabaseRecord } from '../databases/record';
import {
  askedQuestions,
  FILES_UNAVAILABLE,
  fillForm,
  formMentions,
  withoutFileUploads,
} from './fill';
import { definitionForLink, isLinkCode, newLinkCode, type FormView } from './links';
import { gateOf, type Visit } from './visit';

const leak = newId();
const category = newProperty('Category', {
  ...defaultConfig('select'),
  options: [{ id: leak, name: 'Leak', color: 'blue' }],
});
const details = { ...newProperty('Details', defaultConfig('text')), description: 'What happened' };
const photos = newProperty('Photos', defaultConfig('files'));
const assignee = newProperty('Assignee', defaultConfig('person'));
const client = newProperty('Client', relationConfig(newId()));
const secret: Property = {
  ...newProperty('Gate code', defaultConfig('text')),
  access: { see: [{ type: 'user', id: newId() }], change: null },
};
const [name] = newDatabaseSchema().properties as [Property];
const properties = [name, category, details, photos, assignee, client, secret];

const question = (prop: Property, extra: Partial<FormQuestion> = {}): FormQuestion => ({
  propertyId: prop.id,
  text: '',
  description: [],
  required: false,
  display: 'default',
  logic: null,
  ...extra,
});

function record(overrides: Partial<DatabaseRecord> = {}): DatabaseRecord {
  const at = new Date('2026-10-01T15:00:00.000Z');
  return {
    id: newId(),
    workspaceId: newId(),
    spaceId: newId(),
    parentId: newId(),
    title: 'Service requests',
    pageIcon: null,
    inline: false,
    inTrash: false,
    version: 3,
    nextUniqueNumber: 1,
    createdAt: at,
    updatedAt: at,
    description: [],
    properties,
    views: [],
    templates: [],
    accessRules: [],
    defaultTemplateId: null,
    locked: false,
    rowPageLayout: null,
    subItems: null,
    dependencies: null,
    deletedProperties: [],
    ...overrides,
  };
}

function formView(changes: Partial<FormDefinition> = {}): FormView {
  const view = defaultView('form', properties, { databaseTitle: 'Service requests' });
  return { ...view, form: { ...view.form!, ...changes } } as FormView;
}

describe('the fill screen form', () => {
  it('asks only questions whose property exists and can be asked, once each, in order', () => {
    const form = formView({
      questions: [
        question(category),
        question(newProperty('Gone', defaultConfig('text'))),
        question(details),
        question(category, { text: 'Again' }),
        question(assignee),
        question(client),
      ],
    }).form;
    const asked = (f: FormDefinition) => askedQuestions(f, properties).map((q) => q.prop.name);
    expect(asked(form)).toEqual(['Category', 'Details', 'Assignee', 'Client']);
    // A form anyone can fill in has no Person or Relation questions.
    expect(asked({ ...form, audience: 'anyone' })).toEqual(['Category', 'Details']);
  });

  it('gives the words, the questions and only their properties', () => {
    const view = formView({
      title: '  ',
      description: [{ text: 'Tell us about the job.' }],
      questions: [
        question(name, { text: 'Address', required: true }),
        question(details, { logicChanged: true }),
        question(secret),
      ],
    });
    const form = fillForm(record({ views: [view] }), view, new Set());
    expect(form).toMatchObject({
      id: view.id,
      title: 'Service requests',
      description: [{ text: 'Tell us about the job.' }],
      submitLabel: 'Submit',
      confirmation: [{ text: 'Thanks! Your response was sent.' }],
      allowMultiple: true,
      anonymous: false,
      anonymousLine: null,
      audience: 'members',
      cover: null,
      icon: null,
      uploads: { available: false, message: FILES_UNAVAILABLE },
    });
    expect(form.questions).toEqual([
      { ...question(name, { text: 'Address', required: true }) },
      { ...question(details, { text: 'Details' }) },
      { ...question(secret, { text: 'Gate code' }) },
    ]);
    // A form shows its own questions; property access lists never go out.
    expect(form.properties).toEqual([
      { id: name.id, name: 'Name', description: '', config: name.config, rowPage: name.rowPage },
      {
        id: details.id,
        name: 'Details',
        description: 'What happened',
        config: details.config,
        rowPage: details.rowPage,
      },
      {
        id: secret.id,
        name: 'Gate code',
        description: '',
        config: secret.config,
        rowPage: secret.rowPage,
      },
    ]);
  });

  it('says when answers are anonymous', () => {
    const view = formView({ anonymous: true, allowMultiple: false });
    const form = fillForm(record(), view, new Set());
    expect(form.anonymous).toBe(true);
    expect(form.anonymousLine).toBe("Your name isn't recorded with this form.");
    expect(fillForm(record(), formView({ audience: 'anyone' }), new Set()).anonymous).toBe(true);
  });

  it('keeps file questions while uploads are off, but never required', () => {
    const asked = [question(photos, { required: true }), question(category, { required: true })];
    const form = formView({ questions: asked }).form;
    expect(withoutFileUploads(form, properties).questions.map((q) => q.required)).toEqual([
      false,
      true,
    ]);
    const plain = formView({ questions: [question(photos)] }).form;
    expect(withoutFileUploads(plain, properties)).toBe(plain);
    const view = formView({ questions: asked });
    expect(fillForm(record(), view, new Set()).questions[0]).toMatchObject({ required: false });
  });

  it('leaves out the titles of mentioned pages the person can’t open', () => {
    const [open, closed] = [newId(), newId()];
    const mention = (id: string, text: string) => ({
      text,
      mention: { kind: 'page' as const, id },
    });
    const view = formView({
      description: [{ text: 'See ' }, mention(open, 'Price list')],
      confirmation: [mention(closed, 'Payroll')],
      questions: [question(details, { description: [mention(closed, 'Payroll')] })],
    });
    expect(formMentions(view.form)).toEqual([open, closed]);
    const form = fillForm(record(), view, new Set([open]));
    expect(form.description).toEqual([{ text: 'See ' }, mention(open, 'Price list')]);
    expect(form.confirmation).toEqual([mention(closed, '')]);
    expect(form.questions[0]!.description).toEqual([mention(closed, '')]);
  });
});

describe('link codes', () => {
  it('makes 16 random bytes as base64url', () => {
    const code = newLinkCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newLinkCode()).not.toBe(code);
    expect(isLinkCode(code)).toBe(true);
    expect(isLinkCode(newId().replace(/-/g, ''))).toBe(true);
    for (const bad of [
      '',
      'short',
      'a'.repeat(65),
      'has space in it ok?',
      'x/../../etc/passwd',
      7,
    ]) {
      expect(isLinkCode(bad)).toBe(false);
    }
  });

  it('never opens a form with a revoked code', () => {
    const form = formView().form;
    const link = { code: form.linkCode, databaseId: newId(), viewId: newId(), revoked: false };
    expect(definitionForLink(form, link)).toBe(form);
    expect(definitionForLink(form, { ...link, revoked: true }).linkCode).toBe('');
    expect(definitionForLink(form, { ...link, code: newLinkCode(), revoked: true })).toBe(form);
  });
});

describe('the gate', () => {
  const base = (form: FormDefinition, changes: Partial<Visit> = {}): Visit => ({
    record: record(),
    form,
    linkCode: form.linkCode,
    visitor: 'member',
    level: 'none',
    responseCount: 0,
    respondedAt: null,
    workspaceName: 'Blue Pine Plumbing',
    now: new Date('2026-10-27T16:00:00.000Z'),
    ...changes,
  });
  const form = formView().form;
  const gate = (f: FormDefinition, changes: Partial<Visit> = {}) => gateOf(base(f, changes));
  const membersOnly = 'This form is only for members of Blue Pine Plumbing.';

  it('opens for members, whatever their level on the database', () => {
    expect(gate(form)).toEqual({ state: 'open', message: null });
  });

  it('turns away guests and people outside the workspace from members-only forms', () => {
    expect(gate(form, { visitor: 'guest' })).toEqual({ state: 'not_member', message: membersOnly });
    expect(gate(form, { visitor: 'outsider', level: 'full' })).toEqual({
      state: 'not_member',
      message: membersOnly,
    });
    const guests = { ...form, audience: 'members_and_guests' as const };
    expect(gate(guests, { visitor: 'guest' }).state).toBe('open');
    expect(gate(guests, { visitor: 'outsider' }).message).toBe(membersOnly);
    expect(gate({ ...form, audience: 'anyone' }, { visitor: 'outsider' }).state).toBe('open');
  });

  it('shows the closed states with their words', () => {
    const off = { ...form, accepting: false };
    expect(gate(off).message).toBe("This form isn't accepting responses.");
    expect(gate(form, { record: record({ inTrash: true }) }).message).toBe(
      "This form isn't accepting responses.",
    );
    const dated = { ...form, closeAt: '2026-10-20T18:00:00.000Z' };
    expect(gate(dated)).toEqual({ state: 'closed', message: 'This form closed on Oct 20, 2026.' });
    const full = { ...form, maxResponses: 2 };
    expect(gate(full, { responseCount: 1 }).state).toBe('open');
    expect(gate(full, { responseCount: 2 })).toEqual({
      state: 'closed',
      message: "This form isn't taking more responses.",
    });
  });

  it('lets people who can edit test in the Form view, not through the link', () => {
    const off = { ...form, accepting: false };
    expect(gate(off, { linkCode: null, level: 'edit' }).state).toBe('open');
    expect(gate(off, { linkCode: null, level: 'view' }).state).toBe('not_accepting');
    expect(gate(off, { level: 'full' }).state).toBe('not_accepting');
    expect(gate(off, { linkCode: null, level: 'full', visitor: 'outsider' }).state).toBe(
      'not_member',
    );
  });

  it('allows one response per person when the form says so, except anonymous forms', () => {
    const once = { ...form, allowMultiple: false };
    const respondedAt = '2026-10-26T17:00:00.000Z';
    expect(gate(once, { respondedAt })).toEqual({
      state: 'already_responded',
      message: 'You already responded on Oct 26, 2026.',
    });
    expect(gate({ ...once, anonymous: true }, { respondedAt }).state).toBe('open');
  });

  it('says a changed link has changed', () => {
    expect(gate(form, { linkCode: newLinkCode() })).toEqual({
      state: 'link_changed',
      message: 'This form link has changed. Ask the person who sent it for the new one.',
    });
  });
});
