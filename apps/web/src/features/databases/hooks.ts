/**
 * Server data for databases (TanStack Query). Query keys start with 'databases' and the database
 * id (decision 0007 section 5.2), so one invalidation refreshes everything about a database.
 * Row changes show at once in every cached view and roll back if the server refuses.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { Id, Row, SelectOption, View, ViewOverride } from '@carehub/databases';
import {
  createDatabaseClient,
  isApiError,
  type CreateRowRequest,
  type DatabaseClient,
  type DatabaseSettings,
  type DatabaseWithVersion,
  type QueryRequest,
  type RowDetail,
  type RowValues,
  type SettingsAnswer,
} from './api';
import {
  mapQueryRows,
  mergeMore,
  moreRequest,
  moveInCache,
  savedOptionIds,
  titlePropertyId,
  withOptionIds,
  withTypedOptions,
  withValues,
  type CachePlace,
} from './cache';
import {
  isBlocked,
  loadMoreKey,
  type ViewData,
  type ViewQueryData,
  type ViewQueryResult,
} from './contract';

// ---------------------------------------------------------------- the client

const DatabaseClientContext = createContext<DatabaseClient | null>(null);
let defaultClient: DatabaseClient | undefined;

/** Gives every database screen inside it this client (tests pass mockClient()). */
export function DatabaseClientProvider({
  client,
  children,
}: {
  client: DatabaseClient;
  children?: ReactNode;
}) {
  return createElement(DatabaseClientContext.Provider, { value: client }, children);
}

export function useDatabaseClient(): DatabaseClient {
  const client = useContext(DatabaseClientContext);
  if (client) return client;
  defaultClient ??= createDatabaseClient();
  return defaultClient;
}

// ---------------------------------------------------------------- keys

export const databaseKeys = {
  all: (databaseId: Id) => ['databases', databaseId] as const,
  meta: (databaseId: Id) => ['databases', databaseId, 'meta'] as const,
  queries: (databaseId: Id) => ['databases', databaseId, 'query'] as const,
  query: (databaseId: Id, viewId: Id, override: ViewOverride | null, search: string) =>
    ['databases', databaseId, 'query', viewId, override, search] as const,
  row: (databaseId: Id, rowId: Id) => ['databases', databaseId, 'row', rowId] as const,
  rows: (databaseId: Id) => ['databases', databaseId, 'row'] as const,
  chart: (databaseId: Id, viewId: Id, override: ViewOverride | null) =>
    ['databases', databaseId, 'chart', viewId, override] as const,
  pick: (databaseId: Id, q: string) => ['databases', databaseId, 'pick', q] as const,
  /** The mutation key of a database's settings writes (they go one at a time). */
  settings: (databaseId: Id) => ['databases', databaseId, 'settings'] as const,
  /** The workspace's people matching `q`: not one database's, so no database refresh drops them. */
  members: (q: string) => ['databases', 'members', q] as const,
};

// ---------------------------------------------------------------- reading

export function useDatabase(databaseId: Id) {
  const client = useDatabaseClient();
  return useQuery({
    queryKey: databaseKeys.meta(databaseId),
    queryFn: () => client.getDatabase(databaseId),
  });
}

export interface ViewDataOptions {
  /** "Changed for you only" on top of the saved view. */
  override?: ViewOverride | null;
  /** Toolbar search (never saved). */
  search?: string;
  enabled?: boolean;
}

export interface ViewDataResult {
  /** undefined until the first answer, and while the view is blocked. */
  data: ViewData | undefined;
  /** The view uses a property the viewer can't see: show this instead of rows. */
  blocked: string | null;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  loadMore: (groupKey?: string, subGroupKey?: string) => Promise<void>;
}

function queryRequest(viewId: Id, override: ViewOverride | null, search: string): QueryRequest {
  return { viewId, override, search };
}

/** A view's rows. Keeps showing the last answer while a new search or filter loads. */
export function useViewData(
  databaseId: Id,
  viewId: Id | null,
  options: ViewDataOptions = {},
): ViewDataResult {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  const override = options.override ?? null;
  const search = options.search?.trim() ?? '';
  const key = databaseKeys.query(databaseId, viewId ?? '', override, search);

  const query = useQuery({
    queryKey: key,
    queryFn: () => client.query(databaseId, queryRequest(viewId ?? '', override, search)),
    enabled: viewId !== null && options.enabled !== false,
    // Another view's rows would draw wrongly in this layout, so only the same view carries over.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === viewId ? previous : undefined,
  });

  const [loadingMore, setLoadingMore] = useState<readonly string[]>([]);
  const inFlight = useRef(new Set<string>());

  const loadMore = useCallback(
    async (groupKey?: string, subGroupKey?: string) => {
      if (viewId === null) return;
      const at = databaseKeys.query(databaseId, viewId, override, search);
      const current = queryClient.getQueryData<ViewQueryResult>(at);
      if (!current || isBlocked(current)) return;
      const more = moreRequest(current, groupKey, subGroupKey);
      const name = loadMoreKey(groupKey, subGroupKey);
      if (!more || inFlight.current.has(name)) return;
      inFlight.current.add(name);
      setLoadingMore((names) => [...names, name]);
      try {
        const page = await client.query(databaseId, {
          ...queryRequest(viewId, override, search),
          ...more,
        });
        queryClient.setQueryData<ViewQueryResult>(at, (old) => {
          if (!old || isBlocked(old)) return old;
          return isBlocked(page) ? page : mergeMore(old, page, groupKey, subGroupKey);
        });
      } finally {
        inFlight.current.delete(name);
        setLoadingMore((names) => names.filter((n) => n !== name));
      }
    },
    [client, queryClient, databaseId, viewId, override, search],
  );

  const answer = query.data;
  const data = useMemo<ViewData | undefined>(
    () =>
      answer && !isBlocked(answer)
        ? { ...answer, refreshing: query.isPlaceholderData, loadingMore }
        : undefined,
    [answer, query.isPlaceholderData, loadingMore],
  );

  return {
    data,
    blocked: answer && isBlocked(answer) ? answer.blocked : null,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    loadMore,
  };
}

/** One row with computed values and relation titles (row pages). */
export function useRow(databaseId: Id, rowId: Id | null) {
  const client = useDatabaseClient();
  return useQuery({
    queryKey: databaseKeys.row(databaseId, rowId ?? ''),
    queryFn: () => client.getRow(databaseId, rowId ?? ''),
    enabled: rowId !== null,
  });
}

/** Relation pickers: up to 20 titles of rows the viewer can open. */
export function usePickRows(databaseId: Id, q: string) {
  const client = useDatabaseClient();
  return useQuery({
    queryKey: databaseKeys.pick(databaseId, q),
    queryFn: () => client.pickRows(databaseId, q),
    placeholderData: keepPreviousData,
  });
}

/** The workspace's people (guests included) matching `q`, kept for a minute: Person pickers. */
export function membersQuery(client: DatabaseClient, q: string) {
  return {
    queryKey: databaseKeys.members(q),
    queryFn: () => client.listMembers(q),
    staleTime: 60_000,
  };
}

/** Chart views. The answer's shape is the chart engine's (checked by the chart layout). */
export function useChartData(databaseId: Id, viewId: Id, override: ViewOverride | null = null) {
  const client = useDatabaseClient();
  return useQuery({
    queryKey: databaseKeys.chart(databaseId, viewId, override),
    queryFn: () => client.chart(databaseId, { viewId, override }),
  });
}

// ---------------------------------------------------------------- optimistic row changes

type Snapshot = [QueryKey, unknown][];

function snapshotDatabase(queryClient: QueryClient, databaseId: Id): Snapshot {
  return queryClient.getQueriesData<unknown>({ queryKey: databaseKeys.all(databaseId) });
}

function restore(queryClient: QueryClient, snapshot: Snapshot | undefined) {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
}

/** Applies a change to every cached answer of the database's views. */
function changeQueries(
  queryClient: QueryClient,
  databaseId: Id,
  change: (data: ViewQueryData) => ViewQueryData,
  viewId?: Id,
) {
  const queryKey = viewId
    ? [...databaseKeys.queries(databaseId), viewId]
    : databaseKeys.queries(databaseId);
  queryClient.setQueriesData<ViewQueryResult>({ queryKey }, (old) =>
    old && !isBlocked(old) ? change(old) : old,
  );
}

async function holdQueries(queryClient: QueryClient, databaseId: Id): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: databaseKeys.queries(databaseId) });
  return snapshotDatabase(queryClient, databaseId);
}

function refreshQueries(queryClient: QueryClient, databaseId: Id) {
  return queryClient.invalidateQueries({ queryKey: databaseKeys.queries(databaseId) });
}

export function useCreateRow(databaseId: Id) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateRowRequest) => client.createRow(databaseId, request),
    onSettled: () => refreshQueries(queryClient, databaseId),
  });
}

export interface UpdateValuesInput {
  rowId: Id;
  values: RowValues;
  /** Options typed into Select or Multi-select cells, by property id: added before saving. */
  newOptions?: Partial<Record<Id, readonly SelectOption[]>>;
}

/**
 * Changed values of one row, shown at once in every view and on its row page. Options typed into
 * a cell go into their property first; one the property already has by name is saved instead.
 */
export function useUpdateValues(databaseId: Id) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  const addOptions = useAddOptions(databaseId);
  return useMutation({
    mutationFn: async ({ rowId, values, newOptions }: UpdateValuesInput) => {
      let saved = values;
      for (const [propertyId, typed] of Object.entries(newOptions ?? {})) {
        if (!typed || typed.length === 0) continue;
        const meta = await addOptions.mutateAsync({ propertyId, options: typed });
        const ids = savedOptionIds(
          meta.properties.find((p) => p.id === propertyId),
          typed,
        );
        saved = { ...saved, [propertyId]: withOptionIds(saved[propertyId], ids) };
      }
      return client.updateRow(databaseId, rowId, saved);
    },
    onMutate: async ({ rowId, values }) => {
      const snapshot = await holdQueries(queryClient, databaseId);
      const meta = queryClient.getQueryData<DatabaseWithVersion>(databaseKeys.meta(databaseId));
      const titleId = titlePropertyId(meta?.properties ?? []);
      changeQueries(queryClient, databaseId, (data) =>
        mapQueryRows(data, (row) => (row.id === rowId ? withValues(row, values, titleId) : row)),
      );
      queryClient.setQueryData<RowDetail>(databaseKeys.row(databaseId, rowId), (row) =>
        row ? withValues(row, values, titleId) : row,
      );
      return { snapshot };
    },
    onError: (_error, _input, context) => restore(queryClient, context?.snapshot),
    onSettled: (_row, _error, { rowId }) =>
      Promise.all([
        refreshQueries(queryClient, databaseId),
        queryClient.invalidateQueries({ queryKey: databaseKeys.row(databaseId, rowId) }),
      ]),
  });
}

/** Moves rows to Trash; they leave every view at once. */
export function useTrashRows(databaseId: Id) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowIds: readonly Id[]) => client.trashRows(databaseId, rowIds),
    onMutate: async (rowIds) => {
      const snapshot = await holdQueries(queryClient, databaseId);
      const gone = new Set(rowIds);
      changeQueries(queryClient, databaseId, (data) =>
        mapQueryRows(data, (row) => (gone.has(row.id) ? null : row)),
      );
      return { snapshot };
    },
    onError: (_error, _rowIds, context) => restore(queryClient, context?.snapshot),
    onSettled: () => refreshQueries(queryClient, databaseId),
  });
}

/** Copies rows one after another, in the order given; the copies show once the views refresh. */
export function useDuplicateRows(databaseId: Id) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rowIds: readonly Id[]) => {
      const copies: Row[] = [];
      for (const rowId of rowIds) copies.push(await client.duplicateRow(databaseId, rowId));
      return copies;
    },
    onSettled: () => refreshQueries(queryClient, databaseId),
  });
}

export function useRestoreRows(databaseId: Id) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowIds: readonly Id[]) => client.restoreRows(databaseId, rowIds),
    onSettled: () => refreshQueries(queryClient, databaseId),
  });
}

export interface MoveRowInput {
  rowId: Id;
  place: CachePlace;
  /** The values that put the row in its new group or lane, if it changes group. */
  values?: RowValues;
  /** false while the view is sorted: dragging only changes groups. */
  keepOrder?: boolean;
}

/**
 * Moves a row in one view: into another group or lane (changing its values) and, unless the view
 * is sorted, before `beforeRowId` or to the end in manual order.
 */
export function useMoveRow(databaseId: Id, viewId: Id) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rowId, place, values, keepOrder = true }: MoveRowInput) => {
      if (values && Object.keys(values).length > 0) {
        await client.updateRow(databaseId, rowId, values);
      }
      if (keepOrder)
        await client.moveRow(databaseId, viewId, rowId, place.beforeRowId ?? undefined);
    },
    onMutate: async ({ rowId, place, values }) => {
      const snapshot = await holdQueries(queryClient, databaseId);
      const meta = queryClient.getQueryData<DatabaseWithVersion>(databaseKeys.meta(databaseId));
      const titleId = titlePropertyId(meta?.properties ?? []);
      changeQueries(
        queryClient,
        databaseId,
        (data) => {
          const moved = moveInCache(data, rowId, place);
          if (!values) return moved;
          return mapQueryRows(moved, (row) =>
            row.id === rowId ? withValues(row, values, titleId) : row,
          );
        },
        viewId,
      );
      return { snapshot };
    },
    onError: (_error, _input, context) => restore(queryClient, context?.snapshot),
    onSettled: (_result, _error, { rowId }) =>
      Promise.all([
        refreshQueries(queryClient, databaseId),
        queryClient.invalidateQueries({ queryKey: databaseKeys.row(databaseId, rowId) }),
      ]),
  });
}

// ---------------------------------------------------------------- settings

/**
 * A settings write (decision 0200): the database's own settings, properties, views, view order,
 * templates and access rules. Each sends the database's version, and the server refuses a stale
 * one (409, "This database changed. Reload to see the latest."). So one database's writes go one
 * at a time, each with the version the write before it got back.
 */
export interface SettingsWrite<TInput> {
  /**
   * Sends the change. `meta` is the database as cached: the last answer, with the changes still
   * waiting to be sent shown on top.
   */
  send(client: DatabaseClient, meta: DatabaseWithVersion, input: TInput): Promise<SettingsAnswer>;
  /** The database with the change, shown until the server answers. */
  show?(meta: DatabaseWithVersion, input: TInput): DatabaseWithVersion;
  /** The change only adds things: after a 409 the database reloads and it's sent once more. */
  retryOnConflict?: boolean;
}

/**
 * Runs settings writes: the answer (the whole database) replaces the cached one, a refusal puts
 * back what was shown before, and the views refresh once no other write is waiting.
 */
export function useSettingsWrite<TInput>(databaseId: Id, write: SettingsWrite<TInput>) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  const metaKey = databaseKeys.meta(databaseId);
  const mutationKey = databaseKeys.settings(databaseId);
  const loadMeta = () => client.getDatabase(databaseId);
  // This write is still counted while its callbacks run.
  const othersWaiting = () => queryClient.isMutating({ mutationKey }) > 1;

  return useMutation({
    mutationKey,
    scope: { id: mutationKey.join('/') },
    mutationFn: async (input: TInput) => {
      const meta = await queryClient.ensureQueryData({ queryKey: metaKey, queryFn: loadMeta });
      try {
        return await write.send(client, meta, input);
      } catch (error) {
        if (!write.retryOnConflict || !isApiError(error) || error.status !== 409) throw error;
        const fresh = await queryClient.fetchQuery({
          queryKey: metaKey,
          queryFn: loadMeta,
          staleTime: 0,
        });
        return write.send(client, fresh, input);
      }
    },
    onMutate: async (input) => {
      if (!write.show) return { before: undefined };
      await queryClient.cancelQueries({ queryKey: metaKey });
      const before = queryClient.getQueryData<DatabaseWithVersion>(metaKey);
      if (before) queryClient.setQueryData(metaKey, write.show(before, input));
      return { before };
    },
    onSuccess: (answer) => {
      // Writes still waiting stay shown; the last answer has all of them.
      queryClient.setQueryData<DatabaseWithVersion>(metaKey, (cached) =>
        othersWaiting() && cached ? { ...cached, version: answer.version } : answer,
      );
    },
    onError: async (error, _input, context) => {
      if (isApiError(error) && error.status === 409) {
        // Someone else changed it: the writes still waiting go on top of their change.
        await queryClient.refetchQueries({ queryKey: metaKey });
      } else if (!othersWaiting() && context?.before) {
        const { before } = context;
        // Writes before this one may have answered since: keep the newest version.
        queryClient.setQueryData<DatabaseWithVersion>(metaKey, (cached) => ({
          ...before,
          version: Math.max(before.version, cached?.version ?? 0),
        }));
      }
    },
    onSettled: () =>
      othersWaiting()
        ? undefined
        : queryClient.invalidateQueries({ queryKey: databaseKeys.all(databaseId) }),
  });
}

/**
 * Any other settings write, given the client and the version to send:
 * `change.mutate((client, version) => client.deleteView(databaseId, version, viewId))`.
 */
export function useSettingsChange(databaseId: Id) {
  return useSettingsWrite<(client: DatabaseClient, version: number) => Promise<SettingsAnswer>>(
    databaseId,
    { send: (client, meta, write) => write(client, meta.version) },
  );
}

/** PATCH /:id: Lock structure, the default template, the row page layout, sub-items, dependencies. */
export function useUpdateDatabase(databaseId: Id) {
  return useSettingsWrite<DatabaseSettings>(databaseId, {
    send: (client, meta, settings) => client.updateDatabase(databaseId, meta.version, settings),
    show: (meta, settings) => ({ ...meta, ...definedOnly(settings) }),
  });
}

/** A view change for everyone, shown at once in the tabs, toolbar and layout. */
export function useUpdateView(databaseId: Id) {
  return useSettingsWrite<{ viewId: Id; change: Partial<View> }>(databaseId, {
    send: (client, meta, { viewId, change }) =>
      client.updateView(databaseId, meta.version, viewId, change),
    show: (meta, { viewId, change }) => ({
      ...meta,
      views: meta.views.map((v) => (v.id === viewId ? { ...v, ...change, id: v.id } : v)),
    }),
  });
}

export interface TypedOptions {
  propertyId: Id;
  options: readonly SelectOption[];
}

/**
 * Options typed into a Select or Multi-select cell, added to the property (Can edit; Lock structure
 * doesn't stop it). Names the property already has (ignoring case) aren't added again. Options are
 * only ever added, so after a 409 it reloads the database and tries once more.
 */
export function useAddOptions(databaseId: Id) {
  return useSettingsWrite<TypedOptions>(databaseId, {
    send: async (client, meta, { propertyId, options }) => {
      const property = withTypedOptions(meta, propertyId, options).properties.find(
        (p) => p.id === propertyId,
      );
      const typed = new Set(options.map((o) => o.id));
      const config = property?.config;
      const adds =
        (config?.type === 'select' || config?.type === 'multi_select') &&
        config.options.some((o) => typed.has(o.id));
      if (!config || !adds) return meta;
      return client.updateProperty(databaseId, meta.version, propertyId, { config });
    },
    show: (meta, { propertyId, options }) => withTypedOptions(meta, propertyId, options),
    retryOnConflict: true,
  });
}

/** The fields that are set (undefined leaves a setting as it is; null clears it). */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
