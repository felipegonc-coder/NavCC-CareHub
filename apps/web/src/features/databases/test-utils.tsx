/**
 * Test helpers for database screens: a mocked DatabaseClient answering from the fixture database
 * (fixtures.ts), LayoutProps with mocked actions, and render helpers with every provider a
 * database screen needs. Nothing here touches the network.
 */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, type Mock } from 'vitest';
import type { Id, Row } from '@carehub/databases';
import {
  ApiError,
  personChoice,
  type DatabaseClient,
  type Member,
  type RowDetail,
  type RowValues,
} from './api';
import type { LayoutProps, ViewActions } from './contract';
import {
  fixtureRow,
  groupedByStatus,
  jobsDatabase,
  jobsMembers,
  jobsRows,
  queryData,
  testViewer,
  viewData,
  VIEWS,
} from './fixtures';
import { DatabaseClientProvider } from './hooks';

export * from './fixtures';

// ---------------------------------------------------------------- mocks

export type MockClient = { [K in keyof DatabaseClient]: Mock<DatabaseClient[K]> };
export type MockActions = { [K in keyof ViewActions]: Mock<ViewActions[K]> };

const NOT_FOUND = 'This was deleted, or the link is wrong.';

function savedRow(rowId: Id): Row {
  const found = jobsRows().find((r) => r.id === rowId);
  if (!found) throw new ApiError(404, 'not_found', NOT_FOUND);
  return found;
}

function changedRow(rowId: Id, values: RowValues): Row {
  const before = savedRow(rowId);
  return { ...before, values: { ...before.values, ...values } };
}

/** The fixture's people whose name or email has `q` in it, ignoring case. */
function membersMatching(q = ''): Member[] {
  const query = q.trim().toLowerCase();
  return jobsMembers().filter(
    (m) => m.name.toLowerCase().includes(query) || m.email.toLowerCase().includes(query),
  );
}

/**
 * Every method is a vi.fn answering from the fixture: the Jobs database, its rows (the board view
 * grouped by Status), its people and `{ ok: true }`. Change one with
 * `client.query.mockResolvedValue(...)`.
 */
export function mockClient(): MockClient {
  const meta = async () => jobsDatabase();
  const ok = async () => ({ ok: true as const });
  const answers: DatabaseClient = {
    createDatabase: meta,
    getDatabase: meta,
    updateDatabase: meta,
    createProperty: meta,
    updateProperty: async () => ({ ...jobsDatabase(), cleared: 0 }),
    undoTypeChange: meta,
    deleteProperty: meta,
    restoreProperty: meta,
    duplicateProperty: meta,
    createView: async () => ({ ...jobsDatabase(), viewId: 'view-new' }),
    updateView: meta,
    deleteView: meta,
    duplicateView: async () => ({ ...jobsDatabase(), viewId: 'view-copy' }),
    orderViews: meta,
    query: async (_databaseId, { viewId }) =>
      viewId === VIEWS.board ? groupedByStatus() : queryData(),
    chart: async () => ({}),
    createRow: async (_databaseId, request) =>
      fixtureRow('row-new', request.title ?? '', 5, request.values ?? {}),
    getRow: async (_databaseId, rowId): Promise<RowDetail> => ({
      ...savedRow(rowId),
      computed: {},
      rowTitles: {},
    }),
    updateRow: async (_databaseId, rowId, values) => changedRow(rowId, values),
    updateRows: ok,
    trashRows: ok,
    restoreRows: ok,
    duplicateRow: async (_databaseId, rowId) => ({ ...savedRow(rowId), id: 'row-copy' }),
    moveRow: ok,
    pickRows: async (_databaseId, q) =>
      jobsRows()
        .filter((r) => r.title.toLowerCase().includes(q.toLowerCase()))
        .map((r) => ({ id: r.id, title: r.title, icon: null })),
    createTemplate: async () => ({ ...jobsDatabase(), templateId: 'template-new' }),
    updateTemplate: meta,
    deleteTemplate: meta,
    applyTemplate: async (_databaseId, _templateId, rowId) => savedRow(rowId),
    setAccessRules: meta,
    pressButton: async () => ({}),
    undoButtonRun: ok,
    previewImport: async () => ({}),
    startImport: async () => ({}),
    undoImport: ok,
    exportCsv: async () => ({ jobId: 'job-export' }),
    getForm: async () => ({}),
    submitForm: ok,
    getPublicForm: async () => ({}),
    submitPublicForm: ok,
    changeFormLink: async () => ({ linkCode: 'new-link-code' }),
    listMembers: async (q) => membersMatching(q),
  };
  return Object.fromEntries(
    Object.entries(answers).map(([name, answer]) => [name, vi.fn(answer)]),
  ) as MockClient;
}

export function mockActions(): MockActions {
  return {
    openRow: vi.fn<ViewActions['openRow']>(),
    createRow: vi.fn<ViewActions['createRow']>(async (input) =>
      fixtureRow('row-new', input?.title ?? '', 5, input?.values ?? {}),
    ),
    updateValues: vi.fn<ViewActions['updateValues']>(async (rowId, values) =>
      changedRow(rowId, values),
    ),
    addOptions: vi.fn<ViewActions['addOptions']>(async (_propertyId, options) =>
      Object.fromEntries(options.map((o) => [o.id, o.id])),
    ),
    searchPeople: vi.fn<ViewActions['searchPeople']>(async (query) =>
      membersMatching(query).map(personChoice),
    ),
    duplicateRows: vi.fn<ViewActions['duplicateRows']>(async (rowIds) =>
      rowIds.map((rowId, i) => ({ ...savedRow(rowId), id: `${rowId}-copy`, uniqueNumber: 10 + i })),
    ),
    trashRows: vi.fn<ViewActions['trashRows']>(async () => undefined),
    moveRow: vi.fn<ViewActions['moveRow']>(async () => undefined),
    updateView: vi.fn<ViewActions['updateView']>(async () => undefined),
    setOverride: vi.fn<ViewActions['setOverride']>(),
    loadMore: vi.fn<ViewActions['loadMore']>(async () => undefined),
    openPanel: vi.fn<ViewActions['openPanel']>(),
  };
}

/** Props for rendering a layout on its own: the Jobs table view with every row and mocked actions. */
export function layoutProps(
  overrides: Partial<Omit<LayoutProps, 'actions'>> = {},
): LayoutProps & { actions: MockActions } {
  const meta = overrides.meta ?? jobsDatabase();
  const view = overrides.view ?? meta.views[0];
  if (!view) throw new Error('The fixture database needs a view.');
  return {
    meta,
    view,
    data: overrides.data ?? viewData(view.grouping ? groupedByStatus() : queryData()),
    viewer: overrides.viewer ?? testViewer(),
    actions: mockActions(),
    readOnly: overrides.readOnly ?? false,
  };
}

// ---------------------------------------------------------------- rendering

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export interface DatabaseTestOptions {
  client?: DatabaseClient;
  queryClient?: QueryClient;
  /** The router's starting URL. */
  route?: string;
}

/** A wrapper with the query client, the database client and a router (for renderHook). */
export function databaseWrapper({
  client = mockClient(),
  queryClient = testQueryClient(),
  route = '/',
}: DatabaseTestOptions = {}) {
  return function DatabaseTestWrapper({ children }: { children?: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DatabaseClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </DatabaseClientProvider>
      </QueryClientProvider>
    );
  };
}

/** Renders a database screen with a mocked client (mockClient() unless one is given). */
export function renderWithDatabase(ui: ReactElement, options: DatabaseTestOptions = {}) {
  const client = options.client ?? mockClient();
  const queryClient = options.queryClient ?? testQueryClient();
  const wrapper = databaseWrapper({ ...options, client, queryClient });
  return { ...render(ui, { wrapper }), client, queryClient };
}
