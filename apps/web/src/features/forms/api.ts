/**
 * The fill screen's API (decision 0200, form routes): the form behind a link and sending a
 * response, signed in (`/api/forms/:code`) or, for forms anyone on the network can fill in, with
 * nobody signed in (`/api/forms/public/:code`); plus the people and row searches of Person and
 * Relation questions and file uploads.
 * Requests go through lib/api, which adds the CSRF header to changes (decision 0007 section 3.1).
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
import { api } from '../../lib/api';
import {
  ApiError,
  isApiError,
  OFFLINE_MESSAGE,
  UNKNOWN_ERROR_MESSAGE,
  type FormAnswers,
  type HttpMethod,
  type Ok,
  type RequestJson,
  type RowPick,
} from '../databases/api';
import { uploadWithProgress, type UploadedFile, type UploadOptions } from './uploads';

export type { FormAnswers, Ok, RowPick };

/** What `GET /api/forms/:code` answers. */
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
  /** The person signed in: their id for "Me" in logic, their time zone for dates. */
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
  /** `{ answers }` → `{ ok: true }`. The server checks everything again. */
  submitResponse(code: string, answers: FormAnswers): Promise<Ok>;
  /** The same two for a form anyone can fill in, with nobody signed in. */
  getPublicForm(code: string): Promise<FillForm>;
  submitPublicResponse(code: string, answers: FormAnswers): Promise<Ok>;
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

/** The cover of a form anyone can fill in, for someone not signed in (`/api/files` needs a sign-in). */
export function publicCoverUrl(code: string): string {
  return `/api/forms/public/${seg(code)}/cover`;
}

/** One request through lib/api: the session cookie, JSON and, on changes, the CSRF header. */
export const apiRequest: RequestJson = <T>(method: HttpMethod, path: string, body?: unknown) => {
  switch (method) {
    case 'GET':
      return api.get<T>(path);
    case 'POST':
      return api.post<T>(path, body);
    case 'PUT':
      return api.put<T>(path, body);
    case 'PATCH':
      return api.patch<T>(path, body);
    case 'DELETE':
      return api.delete<T>(path, body);
  }
};

export function createFormsClient(request: RequestJson = apiRequest): FormsClient {
  return {
    getForm: async (code) =>
      parseFillForm(await request<unknown>('GET', `/api/forms/${seg(code)}`)),
    submitResponse: (code, answers) =>
      request<Ok>('POST', `/api/forms/${seg(code)}/responses`, { answers }),
    getPublicForm: async (code) =>
      parseFillForm(await request<unknown>('GET', `/api/forms/public/${seg(code)}`)),
    submitPublicResponse: (code, answers) =>
      request<Ok>('POST', `/api/forms/public/${seg(code)}/responses`, { answers }),
    searchPeople: (q) => request<PersonPick[]>('GET', `/api/workspace/members?q=${seg(q)}`),
    pickRows: (databaseId, q) =>
      request<RowPick[]>('GET', `/api/databases/${seg(databaseId)}/rows/pick?q=${seg(q)}`),
    uploadFile: (file, options) => uploadWithProgress(file, options),
  };
}

/** What to tell the person when a request fails: offline, the server's message, or a general one. */
export function problemText(error: unknown): string {
  if (!isApiError(error)) return UNKNOWN_ERROR_MESSAGE;
  return error.status === 0 ? OFFLINE_MESSAGE : error.message;
}

/**
 * What opening a form link gives: the form (`signedOut` when nobody is signed in, so the response
 * goes through the public route), or the sign-in screen first.
 */
export type LoadedForm = { kind: 'form'; data: FillForm; signedOut: boolean } | { kind: 'sign_in' };

// What the public route answers for a form that isn't open to anyone: sign in first.
const NOT_PUBLIC = new Set([401, 403, 404]);

/**
 * Opens a form link as the person signed in. With nobody signed in, a form anyone can fill in
 * opens as it is; any other sends them to sign in, then straight back.
 */
export async function loadFillForm(client: FormsClient, code: string): Promise<LoadedForm> {
  try {
    const data = await client.getForm(code);
    return data.gate.state === 'sign_in'
      ? { kind: 'sign_in' }
      : { kind: 'form', data, signedOut: false };
  } catch (error) {
    if (!isApiError(error) || error.status !== 401) throw error;
  }
  try {
    const data = await client.getPublicForm(code);
    return data.gate.state === 'sign_in'
      ? { kind: 'sign_in' }
      : { kind: 'form', data, signedOut: true };
  } catch (error) {
    if (isApiError(error) && NOT_PUBLIC.has(error.status)) return { kind: 'sign_in' };
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
