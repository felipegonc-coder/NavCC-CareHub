/**
 * The Databases and Forms API (decision 0200): one typed method per route under /api/databases and
 * /api/forms, and the workspace's people. Screens get the client from DatabaseClientProvider
 * (hooks.ts); tests pass mockClient() from test-utils.tsx and never touch the network.
 *
 * Requests go through `api` from apps/web/src/lib/api.ts (decision 0007 section 5.2): the session
 * cookie, the CSRF header on changes, JSON both ways and ApiError when something fails.
 */
import type {
  DatabaseMeta,
  Id,
  Property,
  PropertyAccess,
  PropertyConfig,
  Row,
  RowAccessRule,
  RowPageLayout,
  RowTemplate,
  View,
  ViewOverride,
  ComputedValue,
} from '@carehub/databases';
import { api, ApiError } from '../../lib/api';
import type { PersonChoice } from './cells/types';
import type { ViewQueryResult } from './contract';

// ---------------------------------------------------------------- requests and errors

export { ApiError };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Sends one JSON request and resolves to the parsed answer, or throws an ApiError. */
export type RequestJson = <T>(method: HttpMethod, path: string, body?: unknown) => Promise<T>;

/** Any error with an HTTP status and a code, whichever API client threw it. */
export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    typeof (error as Partial<ApiError>).status === 'number' &&
    typeof (error as Partial<ApiError>).code === 'string'
  );
}

/** Shown when the server can't be reached at all (lib/api's words). */
export const OFFLINE_MESSAGE = "Can't reach Care Hub. Check your connection, then try again.";
/** Shown when the server fails without saying why. */
export const UNKNOWN_ERROR_MESSAGE = 'Something went wrong. Try again.';

/** One request through lib/api. An answer without a JSON body resolves to undefined. */
export const fetchJson: RequestJson = <T>(method: HttpMethod, path: string, body?: unknown) => {
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

// ---------------------------------------------------------------- shapes

/** `{ ok: true }`: the answer of writes that have nothing else to say. */
export interface Ok {
  ok: true;
}

/** GET /:id. Settings writes send `version` back; a stale one gets 409 conflict. */
export interface DatabaseWithVersion extends DatabaseMeta {
  version: number;
}

/**
 * Every settings write (database, properties, views, templates, access rules) answers with the
 * database as GET /:id would, new version included.
 */
export type SettingsAnswer = DatabaseWithVersion;

/** A property type change answers with how many values it cleared. */
export interface PropertyAnswer extends SettingsAnswer {
  cleared?: number;
}

export type RowValues = Partial<Record<Id, unknown>>;

export interface NewDatabase {
  parentId: Id;
  inline: boolean;
  title?: string;
}

/** PATCH /:id (title and icon go through the pages API). */
export interface DatabaseSettings {
  locked?: boolean;
  defaultTemplateId?: Id | null;
  rowPageLayout?: RowPageLayout;
  subItems?: DatabaseMeta['subItems'];
  dependencies?: DatabaseMeta['dependencies'];
}

export interface NewProperty {
  name: string;
  config: PropertyConfig;
  description?: string;
  rowPage?: Property['rowPage'];
  access?: PropertyAccess;
}

/** A new `config.type` is a type change. */
export type PropertyChange = Partial<Omit<Property, 'id'>>;

export interface QueryRequest {
  viewId: Id;
  override?: ViewOverride | null;
  search?: string;
  /** A group whose rows weren't sent (hidden groups). */
  groupKey?: string;
  /** "Load more": the nextCursor of the view, a group or a sub-group. */
  cursor?: string;
}

export interface ChartRequest {
  viewId: Id;
  override?: ViewOverride | null;
}

export interface CreateRowRequest {
  title?: string;
  values?: RowValues;
  templateId?: Id;
  viewId?: Id;
  groupKey?: string;
  afterRowId?: Id;
}

/** GET /:id/rows/:rowId: visible values, computed values and relation titles. */
export interface RowDetail extends Row {
  computed: Partial<Record<Id, ComputedValue>>;
  rowTitles: Record<Id, string>;
  hiddenLinks?: Partial<Record<Id, number>>;
}

/** A row in a relation picker. */
export interface RowPick {
  id: Id;
  title: string;
  icon?: string | null;
}

export interface NewTemplate {
  name: string;
  icon?: string | null;
  values?: RowValues;
  repeat?: RowTemplate['repeat'];
}

export type TemplateChange = Partial<Omit<RowTemplate, 'id'>>;

/** Import routes: the file is uploaded first (POST /api/files), then named by its id. */
export interface ImportRequest {
  fileId: Id;
  [setting: string]: unknown;
}

export interface ExportRequest {
  viewId?: Id;
  scope: 'view' | 'all';
}

export interface JobStarted {
  jobId: Id;
}

/** Form answers by question id. */
export type FormAnswers = Partial<Record<Id, unknown>>;

export interface FormLink {
  linkCode: string;
}

/** Someone in the workspace, guests included (`GET /api/workspace/members`, decision 0007). */
export interface Member {
  id: Id;
  name: string;
  email: string;
  avatarUrl: string | null;
  roleId: Id;
  roleName: string;
  isGuest: boolean;
}

/** A member as Person cells list them (without a photo their initials show). */
export function personChoice(member: Member): PersonChoice {
  const person: PersonChoice = { id: member.id, name: member.name, email: member.email };
  if (member.avatarUrl) person.avatarUrl = member.avatarUrl;
  return person;
}

// ---------------------------------------------------------------- the client

/**
 * One method per route. Answers that decision 0200 doesn't describe yet are `unknown`: the screen
 * that reads one checks its shape. Settings writes take the database's `version` (from GET /:id or
 * the last settings answer); a stale one gets 409 "This database changed. Reload to see the latest."
 */
export interface DatabaseClient {
  createDatabase(input: NewDatabase): Promise<DatabaseWithVersion>;
  getDatabase(databaseId: Id): Promise<DatabaseWithVersion>;
  updateDatabase(
    databaseId: Id,
    version: number,
    settings: DatabaseSettings,
  ): Promise<SettingsAnswer>;

  createProperty(databaseId: Id, version: number, property: NewProperty): Promise<SettingsAnswer>;
  updateProperty(
    databaseId: Id,
    version: number,
    propertyId: Id,
    change: PropertyChange,
  ): Promise<PropertyAnswer>;
  deleteProperty(databaseId: Id, version: number, propertyId: Id): Promise<SettingsAnswer>;
  restoreProperty(databaseId: Id, version: number, propertyId: Id): Promise<SettingsAnswer>;
  duplicateProperty(databaseId: Id, version: number, propertyId: Id): Promise<SettingsAnswer>;

  createView(databaseId: Id, version: number, view: View): Promise<SettingsAnswer>;
  updateView(
    databaseId: Id,
    version: number,
    viewId: Id,
    change: Partial<View>,
  ): Promise<SettingsAnswer>;
  deleteView(databaseId: Id, version: number, viewId: Id): Promise<SettingsAnswer>;
  duplicateView(databaseId: Id, version: number, viewId: Id): Promise<SettingsAnswer>;
  orderViews(databaseId: Id, version: number, viewIds: readonly Id[]): Promise<SettingsAnswer>;

  query(databaseId: Id, request: QueryRequest): Promise<ViewQueryResult>;
  chart(databaseId: Id, request: ChartRequest): Promise<unknown>;

  createRow(databaseId: Id, request: CreateRowRequest): Promise<Row>;
  getRow(databaseId: Id, rowId: Id): Promise<RowDetail>;
  updateRow(databaseId: Id, rowId: Id, values: RowValues): Promise<Row>;
  updateRows(databaseId: Id, rowIds: readonly Id[], values: RowValues): Promise<Ok>;
  trashRows(databaseId: Id, rowIds: readonly Id[]): Promise<Ok>;
  restoreRows(databaseId: Id, rowIds: readonly Id[]): Promise<Ok>;
  duplicateRow(databaseId: Id, rowId: Id): Promise<Row>;
  moveRow(databaseId: Id, viewId: Id, rowId: Id, beforeRowId?: Id): Promise<Ok>;
  pickRows(databaseId: Id, q: string): Promise<RowPick[]>;

  createTemplate(databaseId: Id, version: number, template: NewTemplate): Promise<SettingsAnswer>;
  updateTemplate(
    databaseId: Id,
    version: number,
    templateId: Id,
    change: TemplateChange,
  ): Promise<SettingsAnswer>;
  deleteTemplate(databaseId: Id, version: number, templateId: Id): Promise<SettingsAnswer>;
  applyTemplate(databaseId: Id, templateId: Id, rowId: Id, replace: boolean): Promise<Row>;

  setAccessRules(
    databaseId: Id,
    version: number,
    rules: readonly RowAccessRule[],
  ): Promise<SettingsAnswer>;

  pressButton(databaseId: Id, rowId: Id, propertyId: Id): Promise<unknown>;
  undoButtonRun(databaseId: Id, runId: Id): Promise<Ok>;

  previewImport(databaseId: Id, request: ImportRequest): Promise<unknown>;
  startImport(databaseId: Id, request: ImportRequest): Promise<unknown>;
  undoImport(databaseId: Id, importId: Id): Promise<Ok>;
  exportCsv(databaseId: Id, request: ExportRequest): Promise<JobStarted>;

  getForm(code: string): Promise<unknown>;
  submitForm(code: string, answers: FormAnswers): Promise<Ok>;
  getPublicForm(code: string): Promise<unknown>;
  submitPublicForm(code: string, answers: FormAnswers): Promise<Ok>;
  changeFormLink(databaseId: Id, viewId: Id): Promise<FormLink>;

  /** Everyone in the workspace, or those whose name or email matches `q`. */
  listMembers(q?: string): Promise<Member[]>;
}

const seg = encodeURIComponent;

/** DELETE has no body: its version goes in the address. */
const at = (version: number) => `?version=${version}`;

/** Leaves out optional fields that are null, undefined or '' (strict request schemas). */
function compact<T extends object>(body: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

export function createDatabaseClient(request: RequestJson = fetchJson): DatabaseClient {
  const db = (databaseId: Id, rest = '') => `/api/databases/${seg(databaseId)}${rest}`;
  const forms = (rest: string) => `/api/forms${rest}`;

  return {
    createDatabase: (input) => request('POST', '/api/databases', input),
    getDatabase: (databaseId) => request('GET', db(databaseId)),
    updateDatabase: (databaseId, version, settings) =>
      request('PATCH', db(databaseId), { ...settings, version }),

    createProperty: (databaseId, version, property) =>
      request('POST', db(databaseId, '/properties'), { ...property, version }),
    updateProperty: (databaseId, version, propertyId, change) =>
      request('PATCH', db(databaseId, `/properties/${seg(propertyId)}`), { ...change, version }),
    deleteProperty: (databaseId, version, propertyId) =>
      request('DELETE', db(databaseId, `/properties/${seg(propertyId)}${at(version)}`)),
    restoreProperty: (databaseId, version, propertyId) =>
      request('POST', db(databaseId, `/properties/${seg(propertyId)}/restore`), { version }),
    duplicateProperty: (databaseId, version, propertyId) =>
      request('POST', db(databaseId, `/properties/${seg(propertyId)}/duplicate`), { version }),

    createView: (databaseId, version, view) =>
      request('POST', db(databaseId, '/views'), { ...view, version }),
    updateView: (databaseId, version, viewId, change) =>
      request('PATCH', db(databaseId, `/views/${seg(viewId)}`), { ...change, version }),
    deleteView: (databaseId, version, viewId) =>
      request('DELETE', db(databaseId, `/views/${seg(viewId)}${at(version)}`)),
    duplicateView: (databaseId, version, viewId) =>
      request('POST', db(databaseId, `/views/${seg(viewId)}/duplicate`), { version }),
    orderViews: (databaseId, version, viewIds) =>
      request('PUT', db(databaseId, '/views/order'), { viewIds, version }),

    query: (databaseId, body) => request('POST', db(databaseId, '/query'), compact(body)),
    chart: (databaseId, body) => request('POST', db(databaseId, '/chart'), compact(body)),

    createRow: (databaseId, body) => request('POST', db(databaseId, '/rows'), compact(body)),
    getRow: (databaseId, rowId) => request('GET', db(databaseId, `/rows/${seg(rowId)}`)),
    updateRow: (databaseId, rowId, values) =>
      request('PATCH', db(databaseId, `/rows/${seg(rowId)}`), { values }),
    updateRows: (databaseId, rowIds, values) =>
      request('POST', db(databaseId, '/rows/bulk'), { rowIds, values }),
    trashRows: (databaseId, rowIds) => request('POST', db(databaseId, '/rows/trash'), { rowIds }),
    restoreRows: (databaseId, rowIds) =>
      request('POST', db(databaseId, '/rows/restore'), { rowIds }),
    duplicateRow: (databaseId, rowId) =>
      request('POST', db(databaseId, `/rows/${seg(rowId)}/duplicate`)),
    moveRow: (databaseId, viewId, rowId, beforeRowId) =>
      request(
        'PUT',
        db(databaseId, `/views/${seg(viewId)}/order`),
        compact({ rowId, beforeRowId }),
      ),
    pickRows: (databaseId, q) =>
      request('GET', db(databaseId, `/rows/pick?q=${encodeURIComponent(q)}`)),

    createTemplate: (databaseId, version, template) =>
      request('POST', db(databaseId, '/templates'), { ...template, version }),
    updateTemplate: (databaseId, version, templateId, change) =>
      request('PATCH', db(databaseId, `/templates/${seg(templateId)}`), { ...change, version }),
    deleteTemplate: (databaseId, version, templateId) =>
      request('DELETE', db(databaseId, `/templates/${seg(templateId)}${at(version)}`)),
    applyTemplate: (databaseId, templateId, rowId, replace) =>
      request('POST', db(databaseId, `/templates/${seg(templateId)}/apply`), { rowId, replace }),

    setAccessRules: (databaseId, version, rules) =>
      request('PUT', db(databaseId, '/access-rules'), { rules, version }),

    pressButton: (databaseId, rowId, propertyId) =>
      request('POST', db(databaseId, `/rows/${seg(rowId)}/buttons/${seg(propertyId)}`)),
    undoButtonRun: (databaseId, runId) =>
      request('POST', db(databaseId, `/button-runs/${seg(runId)}/undo`)),

    previewImport: (databaseId, body) => request('POST', db(databaseId, '/import/preview'), body),
    startImport: (databaseId, body) => request('POST', db(databaseId, '/import'), body),
    undoImport: (databaseId, importId) =>
      request('POST', db(databaseId, `/imports/${seg(importId)}/undo`)),
    exportCsv: (databaseId, body) => request('POST', db(databaseId, '/export'), compact(body)),

    getForm: (code) => request('GET', forms(`/${seg(code)}`)),
    submitForm: (code, answers) => request('POST', forms(`/${seg(code)}/responses`), { answers }),
    getPublicForm: (code) => request('GET', forms(`/public/${seg(code)}`)),
    submitPublicForm: (code, answers) =>
      request('POST', forms(`/public/${seg(code)}/responses`), { answers }),
    changeFormLink: (databaseId, viewId) =>
      request('POST', forms(`/${seg(databaseId)}/views/${seg(viewId)}/link`)),

    listMembers: (q) =>
      request('GET', q ? `/api/workspace/members?q=${seg(q)}` : '/api/workspace/members'),
  };
}
