/**
 * The fill screen's API (decision 0200, form routes): the form behind a link and sending a
 * response, signed in (`/api/forms/:code`) or, for forms anyone can fill in, signed out
 * (`/api/forms/public/:code`); plus the people and row searches of Person and Relation questions
 * and file uploads. Requests go through the database shell's `fetchJson` until lib/api lands.
 * Screens get the client from FormsClientProvider; tests pass mockFormsClient() (test-utils.tsx).
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type {
  FormDefinition,
  FormLogic,
  FormQuestion,
  Id,
  Property,
  RichText,
} from '@carehub/databases';
import { DEFAULT_TIME_ZONE } from '@carehub/databases';
import type { FormGate, Respondent } from '@carehub/databases/forms';
import {
  ApiError,
  fetchJson,
  isApiError,
  UNKNOWN_ERROR_MESSAGE,
  type FormAnswers,
  type Ok,
  type RequestJson,
  type RowPick,
} from '../databases/api';
import { uploadWithProgress, type UploadedFile, type UploadOptions } from './uploads';

export type { FormAnswers, Ok, RowPick };

/** Signed in (members and guests), or signed out on a form anyone can fill in. */
export type FillAccess = 'member' | 'public';

/** What `GET /api/forms/:code` and `GET /api/forms/public/:code` answer. */
export interface FillForm {
  /** The form view's id: the draft key and the upload scope `forms:<formId>`. */
  formId: Id;
  databaseId: Id;
  /** The form as its fill screen needs it (who gets notified isn't sent). */
  form: FormDefinition;
  /** The properties its questions ask, as this person may see them. */
  properties: Property[];
  /** What opening the form shows: the form ('open'), or a message instead of it. */
  gate: FormGate;
  /** The person signed in (their id for "Me" in logic, their time zone for dates); null signed out. */
  respondent: Respondent | null;
}

/** One person in the Person question's picker (`GET /api/workspace/members?q=`). */
export interface PersonPick {
  id: Id;
  name: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface FormsClient {
  getForm(code: string): Promise<FillForm>;
  getPublicForm(code: string): Promise<FillForm>;
  /** `{ answers }` → `{ ok: true }`. The server checks everything again. */
  submitResponse(code: string, answers: FormAnswers, access: FillAccess): Promise<Ok>;
  searchPeople(q: string): Promise<PersonPick[]>;
  pickRows(databaseId: Id, q: string): Promise<RowPick[]>;
  uploadFile(file: File, options: UploadOptions): Promise<UploadedFile>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const OPEN: FormGate = { state: 'open', message: null };
const GATE_STATES = [
  'link_changed',
  'not_member',
  'not_accepting',
  'closed',
  'already_responded',
] as const;

function readGate(v: unknown): FormGate {
  if (!isRecord(v)) return OPEN;
  if (v.state === 'sign_in') return { state: 'sign_in', message: null };
  const state = GATE_STATES.find((s) => s === v.state);
  if (state && typeof v.message === 'string') return { state, message: v.message };
  return OPEN;
}

const richText = (v: unknown): RichText => (Array.isArray(v) ? (v as RichText) : []);

function readQuestion(v: unknown): FormQuestion[] {
  if (!isRecord(v) || typeof v.propertyId !== 'string') return [];
  const logic = v.logic;
  return [
    {
      propertyId: v.propertyId,
      text: typeof v.text === 'string' ? v.text : '',
      description: richText(v.description),
      required: v.required === true,
      display: v.display === 'long' || v.display === 'dropdown' ? v.display : 'default',
      logic:
        isRecord(logic) && Array.isArray(logic.conditions) ? (logic as unknown as FormLogic) : null,
    },
  ];
}

const isProperty = (v: unknown): v is Property =>
  isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string' && isRecord(v.config);

/** The confirmation every new form starts with (Forms spec). */
export const DEFAULT_CONFIRMATION: RichText = [{ text: 'Thanks! Your response was sent.' }];

/**
 * Reads the form answer, filling in what an older or trimmed answer leaves out. Throws an ApiError
 * when it isn't a form at all.
 */
export function parseFillForm(raw: unknown): FillForm {
  const f = isRecord(raw) && isRecord(raw.form) ? raw.form : null;
  if (
    !isRecord(raw) ||
    !f ||
    typeof raw.formId !== 'string' ||
    !Array.isArray(raw.properties) ||
    !Array.isArray(f.questions)
  ) {
    throw new ApiError(500, 'bad_response', UNKNOWN_ERROR_MESSAGE);
  }
  const audience = f.audience;
  const form: FormDefinition = {
    title: typeof f.title === 'string' ? f.title : '',
    description: richText(f.description),
    questions: f.questions.flatMap(readQuestion),
    submitLabel:
      typeof f.submitLabel === 'string' && f.submitLabel.trim() ? f.submitLabel : 'Submit',
    confirmation: Array.isArray(f.confirmation) ? richText(f.confirmation) : DEFAULT_CONFIRMATION,
    allowMultiple: f.allowMultiple === true,
    accepting: f.accepting !== false,
    linkCode: typeof f.linkCode === 'string' ? f.linkCode : '',
    linkChangedAt: typeof f.linkChangedAt === 'string' ? f.linkChangedAt : null,
    anonymous: f.anonymous === true,
    notifyUserIds: [],
    ...(audience === 'members' || audience === 'members_and_guests' || audience === 'anyone'
      ? { audience }
      : {}),
    cover: isRecord(f.cover) ? (f.cover as unknown as FormDefinition['cover']) : null,
    icon: typeof f.icon === 'string' && f.icon ? f.icon : null,
  };
  const r = raw.respondent;
  const respondent: Respondent | null =
    isRecord(r) && typeof r.userId === 'string'
      ? {
          userId: r.userId,
          timeZone: typeof r.timeZone === 'string' && r.timeZone ? r.timeZone : DEFAULT_TIME_ZONE,
        }
      : null;
  return {
    formId: raw.formId,
    databaseId: typeof raw.databaseId === 'string' ? raw.databaseId : '',
    form,
    properties: raw.properties.filter(isProperty),
    gate: readGate(raw.gate),
    respondent,
  };
}

const seg = encodeURIComponent;

export function createFormsClient(request: RequestJson = fetchJson): FormsClient {
  return {
    getForm: async (code) =>
      parseFillForm(await request<unknown>('GET', `/api/forms/${seg(code)}`)),
    getPublicForm: async (code) =>
      parseFillForm(await request<unknown>('GET', `/api/forms/public/${seg(code)}`)),
    submitResponse: (code, answers, access) =>
      request<Ok>(
        'POST',
        access === 'public'
          ? `/api/forms/public/${seg(code)}/responses`
          : `/api/forms/${seg(code)}/responses`,
        { answers },
      ),
    searchPeople: (q) => request<PersonPick[]>('GET', `/api/workspace/members?q=${seg(q)}`),
    pickRows: (databaseId, q) =>
      request<RowPick[]>('GET', `/api/databases/${seg(databaseId)}/rows/pick?q=${seg(q)}`),
    uploadFile: (file, options) => uploadWithProgress(file, options),
  };
}

/** What opening a form link gives: the form, or the sign-in screen first. */
export type LoadedForm = { kind: 'form'; access: FillAccess; data: FillForm } | { kind: 'sign_in' };

/**
 * Opens a form link: as the person signed in, or (nobody signed in) as a form anyone can fill in.
 * A link that isn't such a form sends them to sign in, then straight back.
 */
export async function loadFillForm(client: FormsClient, code: string): Promise<LoadedForm> {
  try {
    const data = await client.getForm(code);
    if (data.gate.state === 'sign_in') return { kind: 'sign_in' };
    return { kind: 'form', access: 'member', data };
  } catch (error) {
    if (!isApiError(error) || error.status !== 401) throw error;
  }
  try {
    return { kind: 'form', access: 'public', data: await client.getPublicForm(code) };
  } catch (error) {
    if (isApiError(error) && [401, 403, 404].includes(error.status)) return { kind: 'sign_in' };
    throw error;
  }
}

/** Query keys (decision 0007 section 5.2). */
export const formKeys = {
  all: ['forms'] as const,
  link: (code: string) => ['forms', 'link', code] as const,
};

const FormsClientContext = createContext<FormsClient | null>(null);
let defaultClient: FormsClient | undefined;

/** Gives the form screens inside it this client (tests pass mockFormsClient()). */
export function FormsClientProvider({
  client,
  children,
}: {
  client: FormsClient;
  children?: ReactNode;
}) {
  return createElement(FormsClientContext.Provider, { value: client }, children);
}

/** The client from the nearest FormsClientProvider, or the real one. */
export function useFormsClient(): FormsClient {
  const client = useContext(FormsClientContext);
  if (client) return client;
  defaultClient ??= createFormsClient();
  return defaultClient;
}
