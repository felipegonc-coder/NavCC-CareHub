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
  RichText,
  Row,
  RowAccessRule,
  RowPageLayout,
  RowTemplate,
  View,
  ViewLayout,
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

/**
 * GET /:id: the database as this person may see it. Settings writes send `version` back; a stale
 * one gets 409 conflict.
 */
export interface DatabaseWithVersion extends DatabaseMeta {
  /** 1 or more; each save adds 1, and a write that changes nothing keeps it. */
  version: number;
  wiki?: boolean;
  /** Only for people who can edit: properties they can see, deleted in the last 30 days. */
  deletedProperties?: DeletedProperty[];
}

/** restoreProperty(databaseId, property.id) puts it back. */
export interface DeletedProperty {
  property: Property;
  /** ISO time. */
  deletedAt: string;
}

/**
 * Every settings write (database, properties, views, templates, access rules) answers with the
 * database as GET /:id would, new version included.
 */
export type SettingsAnswer = DatabaseWithVersion;

/** A property change answers with how many values a type change or removed options cleared. */
export interface PropertyAnswer extends SettingsAnswer {
  cleared?: number;
  /** A type change, which undoTypeChange can put back until `undoUntil` (ISO time). */
  typeChange?: { id: Id; undoUntil: string };
}

/** A new view, or a view's copy. */
export interface ViewAnswer extends SettingsAnswer {
  viewId: Id;
}

export interface TemplateAnswer extends SettingsAnswer {
  templateId: Id;
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
  /** null: New makes an empty row. */
  defaultTemplateId?: Id | null;
  /** null: back to the usual layout. */
  rowPageLayout?: RowPageLayout | null;
  /** Turns sub-items on or off: the server adds or removes their pair of relations. */
  subItems?: boolean;
  /** null turns dependencies off. */
  dependencies?: { shift: 'shift' | 'none' } | null;
  description?: RichText;
  wiki?: boolean;
}

export interface NewProperty {
  name: string;
  config: PropertyConfig;
  description?: string;
  rowPage?: Property['rowPage'];
  access?: PropertyAccess;
  /** The view it was added from. */
  viewId?: Id;
  afterPropertyId?: Id;
  /** A two-way relation: the name of its pair in the other database. */
  twoWayName?: string;
}

/** A new `config.type` is a type change. */
export type PropertyChange = Partial<Omit<Property, 'id'>>;

export interface NewView {
  layout: ViewLayout;
  name?: string;
  afterViewId?: Id;
  dashboardId?: Id;
}

/** Any view settings but its id, its dashboard and its row order (moveRow changes that). */
export type ViewChange = Partial<Omit<View, 'id' | 'dashboardId' | 'manualOrder'>>;

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
  /** The template to start from; null: an empty row; absent: the view's default template. */
  templateId?: Id | null;
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
  name?: string;
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
 * that reads one checks its shape.
 *
 * Settings writes (the database's own settings, properties, views and their order, templates and
 * access rules) send the database's version, which the client keeps (createDatabaseClient). A stale
 * one gets 409 "This database changed. Reload to see the latest."
 */
export interface DatabaseClient {
  /** A new database has no version yet: its first settings write loads it. */
  createDatabase(input: NewDatabase): Promise<DatabaseMeta>;
  getDatabase(databaseId: Id): Promise<DatabaseWithVersion>;
  updateDatabase(databaseId: Id, settings: DatabaseSettings): Promise<SettingsAnswer>;

  createProperty(databaseId: Id, property: NewProperty): Promise<SettingsAnswer>;
  updateProperty(databaseId: Id, propertyId: Id, change: PropertyChange): Promise<PropertyAnswer>;
  undoTypeChange(databaseId: Id, changeId: Id): Promise<SettingsAnswer>;
  deleteProperty(databaseId: Id, propertyId: Id): Promise<SettingsAnswer>;
  restoreProperty(databaseId: Id, propertyId: Id): Promise<SettingsAnswer>;
  duplicateProperty(databaseId: Id, propertyId: Id): Promise<SettingsAnswer>;

  createView(databaseId: Id, view: NewView): Promise<ViewAnswer>;
  updateView(databaseId: Id, viewId: Id, change: ViewChange): Promise<SettingsAnswer>;
  deleteView(databaseId: Id, viewId: Id): Promise<SettingsAnswer>;
  duplicateView(databaseId: Id, viewId: Id): Promise<ViewAnswer>;
  orderViews(databaseId: Id, viewIds: readonly Id[]): Promise<SettingsAnswer>;

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

  createTemplate(databaseId: Id, template: NewTemplate): Promise<TemplateAnswer>;
  updateTemplate(databaseId: Id, templateId: Id, change: TemplateChange): Promise<SettingsAnswer>;
  deleteTemplate(databaseId: Id, templateId: Id): Promise<SettingsAnswer>;
  applyTemplate(databaseId: Id, templateId: Id, rowId: Id, replace: boolean): Promise<Row>;

  setAccessRules(databaseId: Id, rules: readonly RowAccessRule[]): Promise<SettingsAnswer>;

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

/** Leaves out optional fields that are null, undefined or '' (strict request schemas). */
function compact<T extends object>(body: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

/**
 * The client over `request` (lib/api unless a test passes its own). Settings writes send the newest
 * version an answer has shown it (GET /:id, a new database, or a settings answer), loading the
 * database first if no answer has yet. DELETE has no body, so its version goes in the address.
 */
export function createDatabaseClient(request: RequestJson = fetchJson): DatabaseClient {
  const db = (databaseId: Id, rest = '') => `/api/databases/${seg(databaseId)}${rest}`;
  const forms = (rest: string) => `/api/forms${rest}`;

  // By database. Versions only go up, so an answer that arrives late can't lower one.
  const versions = new Map<Id, number>();
  const seen = <T extends DatabaseWithVersion>(databaseId: Id, answer: T): T => {
    if (typeof answer?.version === 'number') {
      versions.set(databaseId, Math.max(answer.version, versions.get(databaseId) ?? 0));
    }
    return answer;
  };
  const getDatabase = async (databaseId: Id) =>
    seen(databaseId, await request<DatabaseWithVersion>('GET', db(databaseId)));
  const write = async <T extends SettingsAnswer = SettingsAnswer>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    databaseId: Id,
    rest: string,
    body: object = {},
  ): Promise<T> => {
    const version = versions.get(databaseId) ?? (await getDatabase(databaseId)).version;
    const answer =
      method === 'DELETE'
        ? await request<T>(method, db(databaseId, `${rest}?version=${version}`))
        : await request<T>(method, db(databaseId, rest), { ...body, version });
    return seen(databaseId, answer);
  };

  return {
    createDatabase: (input) => request('POST', '/api/databases', input),
    getDatabase,
    updateDatabase: (databaseId, settings) => write('PATCH', databaseId, '', settings),

    createProperty: (databaseId, property) => write('POST', databaseId, '/properties', property),
    updateProperty: (databaseId, propertyId, change) =>
      write<PropertyAnswer>('PATCH', databaseId, `/properties/${seg(propertyId)}`, change),
    undoTypeChange: (databaseId, changeId) =>
      write('POST', databaseId, `/type-changes/${seg(changeId)}/undo`),
    deleteProperty: (databaseId, propertyId) =>
      write('DELETE', databaseId, `/properties/${seg(propertyId)}`),
    restoreProperty: (databaseId, propertyId) =>
      write('POST', databaseId, `/properties/${seg(propertyId)}/restore`),
    duplicateProperty: (databaseId, propertyId) =>
      write('POST', databaseId, `/properties/${seg(propertyId)}/duplicate`),

    createView: (databaseId, view) => write<ViewAnswer>('POST', databaseId, '/views', view),
    updateView: (databaseId, viewId, change) =>
      write('PATCH', databaseId, `/views/${seg(viewId)}`, change),
    deleteView: (databaseId, viewId) => write('DELETE', databaseId, `/views/${seg(viewId)}`),
    duplicateView: (databaseId, viewId) =>
      write<ViewAnswer>('POST', databaseId, `/views/${seg(viewId)}/duplicate`),
    orderViews: (databaseId, viewIds) => write('PUT', databaseId, '/views/order', { viewIds }),

    query: (databaseId, body) => request('POST', db(databaseId, '/query'), compact(body)),
    chart: (databaseId, body) => request('POST', db(databaseId, '/chart'), compact(body)),

    createRow: (databaseId, body) =>
      request('POST', db(databaseId, '/rows'), {
        ...compact(body),
        // Sent as null for an empty row: left out, the server starts from the view's default.
        ...(body.templateId === null ? { templateId: null } : {}),
      }),
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

    createTemplate: (databaseId, template) =>
      write<TemplateAnswer>('POST', databaseId, '/templates', template),
    updateTemplate: (databaseId, templateId, change) =>
      write('PATCH', databaseId, `/templates/${seg(templateId)}`, change),
    deleteTemplate: (databaseId, templateId) =>
      write('DELETE', databaseId, `/templates/${seg(templateId)}`),
    applyTemplate: (databaseId, templateId, rowId, replace) =>
      request('POST', db(databaseId, `/templates/${seg(templateId)}/apply`), { rowId, replace }),

    setAccessRules: (databaseId, rules) => write('PUT', databaseId, '/access-rules', { rules }),

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
