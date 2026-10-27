import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Id, Row, SelectOption } from '@carehub/databases';
import { ApiError, type SettingsAnswer } from './api';
import type { ViewData } from './contract';
import {
  useAddOptions,
  useDatabase,
  useDuplicateRows,
  useMoveRow,
  useTrashRows,
  useUpdateDatabase,
  useUpdateValues,
  useUpdateView,
  useViewData,
} from './hooks';
import {
  databaseWrapper,
  JOBS_ID,
  jobsDatabase,
  jobsRows,
  mockClient,
  PRIORITY,
  PROPS,
  queryData,
  STATUS,
  VIEWS,
  type MockClient,
} from './test-utils';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rowOf = (data: ViewData | undefined, rowId: string) => data?.rows.find((r) => r.id === rowId);

describe('useDatabase', () => {
  it('loads the database through the client', async () => {
    const client = mockClient();
    const { result } = renderHook(() => useDatabase(JOBS_ID), {
      wrapper: databaseWrapper({ client }),
    });
    await waitFor(() => expect(result.current.data?.title).toBe('Jobs'));
    expect(client.getDatabase).toHaveBeenCalledWith(JOBS_ID);
  });
});

describe('useViewData', () => {
  it('loads a view and adds the next page on Load more', async () => {
    const client = mockClient();
    const rows = jobsRows();
    client.query
      .mockResolvedValueOnce(queryData(rows.slice(0, 2), { count: 4, nextCursor: 'c2' }))
      .mockResolvedValueOnce(queryData(rows.slice(2), { continued: true }));
    const { result } = renderHook(() => useViewData(JOBS_ID, VIEWS.table, { search: ' ' }), {
      wrapper: databaseWrapper({ client }),
    });
    await waitFor(() => expect(result.current.data?.rows).toHaveLength(2));
    expect(client.query).toHaveBeenCalledWith(JOBS_ID, {
      viewId: VIEWS.table,
      override: null,
      search: '',
    });

    await act(() => result.current.loadMore());
    expect(client.query).toHaveBeenLastCalledWith(JOBS_ID, {
      viewId: VIEWS.table,
      override: null,
      search: '',
      cursor: 'c2',
    });
    expect(result.current.data?.rows.map((r) => r.id)).toEqual([
      'row-sink',
      'row-heater',
      'row-boiler',
      'row-drain',
    ]);
    expect(result.current.data?.nextCursor).toBeNull();
    expect(result.current.data?.loadingMore).toEqual([]);
  });

  it("says when the view uses a property the viewer can't see", async () => {
    const client = mockClient();
    client.query.mockResolvedValue({ blocked: "This view uses a property you can't see." });
    const { result } = renderHook(() => useViewData(JOBS_ID, VIEWS.table), {
      wrapper: databaseWrapper({ client }),
    });
    await waitFor(() =>
      expect(result.current.blocked).toBe("This view uses a property you can't see."),
    );
    expect(result.current.data).toBeUndefined();
  });

  it('waits for a view', () => {
    const client = mockClient();
    const { result } = renderHook(() => useViewData(JOBS_ID, null), {
      wrapper: databaseWrapper({ client }),
    });
    expect(result.current.data).toBeUndefined();
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('row changes', () => {
  it('shows a change at once and goes back when the server refuses', async () => {
    const client = mockClient();
    const answer = deferred<Row>();
    client.updateRow.mockReturnValueOnce(answer.promise);
    const { result } = renderHook(
      () => ({
        meta: useDatabase(JOBS_ID),
        view: useViewData(JOBS_ID, VIEWS.table),
        update: useUpdateValues(JOBS_ID),
      }),
      { wrapper: databaseWrapper({ client }) },
    );
    await waitFor(() => expect(result.current.view.data).toBeDefined());
    await waitFor(() => expect(result.current.meta.data).toBeDefined());

    act(() => {
      result.current.update.mutate({
        rowId: 'row-sink',
        values: { [PROPS.name]: 'Fix sink', [PROPS.paid]: true },
      });
    });
    await waitFor(() =>
      expect(rowOf(result.current.view.data, 'row-sink')?.title).toBe('Fix sink'),
    );
    expect(rowOf(result.current.view.data, 'row-sink')?.values[PROPS.paid]).toBe(true);

    await act(async () => {
      answer.reject(new ApiError(403, 'forbidden', "You don't have access to this."));
      await answer.promise.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.update.error).toMatchObject({ code: 'forbidden' });
    expect(rowOf(result.current.view.data, 'row-sink')?.title).toBe('Fix kitchen sink leak');
    expect(rowOf(result.current.view.data, 'row-sink')?.values[PROPS.paid]).toBe(false);
  });

  it('takes trashed rows out of the view at once', async () => {
    const client = mockClient();
    const answer = deferred<{ ok: true }>();
    client.trashRows.mockReturnValueOnce(answer.promise);
    const { result } = renderHook(
      () => ({ view: useViewData(JOBS_ID, VIEWS.board), trash: useTrashRows(JOBS_ID) }),
      { wrapper: databaseWrapper({ client }) },
    );
    await waitFor(() => expect(result.current.view.data?.count).toBe(4));

    act(() => {
      result.current.trash.mutate(['row-heater']);
    });
    await waitFor(() => expect(result.current.view.data?.count).toBe(3));
    const notStarted = result.current.view.data?.groups?.find((g) => g.label === 'Not started');
    expect(notStarted?.rows.map((r) => r.id)).toEqual(['row-drain']);
    expect(client.trashRows).toHaveBeenCalledWith(JOBS_ID, ['row-heater']);
  });
});

describe('useMoveRow', () => {
  const toDone = {
    fromGroupKey: STATUS.notStarted,
    toGroupKey: STATUS.done,
    beforeRowId: 'row-boiler',
  };

  it('shows a card in its new column at once, then saves its value and its place', async () => {
    const client = mockClient();
    const answer = deferred<Row>();
    client.updateRow.mockReturnValueOnce(answer.promise);
    const { result } = renderHook(
      () => ({
        view: useViewData(JOBS_ID, VIEWS.board),
        move: useMoveRow(JOBS_ID, VIEWS.board),
      }),
      { wrapper: databaseWrapper({ client }) },
    );
    await waitFor(() => expect(result.current.view.data?.count).toBe(4));

    act(() => {
      result.current.move.mutate({
        rowId: 'row-heater',
        place: toDone,
        values: { [PROPS.status]: STATUS.done },
      });
    });
    const done = () => result.current.view.data?.groups?.find((g) => g.key === STATUS.done);
    await waitFor(() =>
      expect(done()?.rows.map((r) => r.id)).toEqual(['row-heater', 'row-boiler']),
    );
    expect(done()?.rows[0]?.values[PROPS.status]).toBe(STATUS.done);

    await act(async () => {
      answer.resolve(jobsRows()[1] as Row);
      await answer.promise;
    });
    await waitFor(() => expect(client.moveRow).toHaveBeenCalledTimes(1));
    expect(client.updateRow).toHaveBeenCalledWith(JOBS_ID, 'row-heater', {
      [PROPS.status]: STATUS.done,
    });
    expect(client.moveRow).toHaveBeenCalledWith(JOBS_ID, VIEWS.board, 'row-heater', 'row-boiler');
  });

  it('only changes the value while the view is sorted', async () => {
    const client = mockClient();
    const { result } = renderHook(() => useMoveRow(JOBS_ID, VIEWS.board), {
      wrapper: databaseWrapper({ client }),
    });
    await act(() =>
      result.current.mutateAsync({
        rowId: 'row-heater',
        place: toDone,
        values: { [PROPS.status]: STATUS.done },
        keepOrder: false,
      }),
    );
    expect(client.updateRow).toHaveBeenCalledTimes(1);
    expect(client.moveRow).not.toHaveBeenCalled();
  });

  it('only saves the place for a move in manual order', async () => {
    const client = mockClient();
    const { result } = renderHook(() => useMoveRow(JOBS_ID, VIEWS.table), {
      wrapper: databaseWrapper({ client }),
    });
    await act(() =>
      result.current.mutateAsync({ rowId: 'row-drain', place: { beforeRowId: null } }),
    );
    expect(client.updateRow).not.toHaveBeenCalled();
    expect(client.moveRow).toHaveBeenCalledWith(JOBS_ID, VIEWS.table, 'row-drain', undefined);
  });
});

const CONFLICT = 'This database changed. Reload to see the latest.';

describe('settings writes', () => {
  /** The Jobs database with some views renamed. */
  function renamed(version: number, names: Partial<Record<Id, string>>): SettingsAnswer {
    const meta = jobsDatabase({ version });
    return { ...meta, views: meta.views.map((v) => ({ ...v, name: names[v.id] ?? v.name })) };
  }

  function setup() {
    const client = mockClient();
    const { result } = renderHook(
      () => ({ meta: useDatabase(JOBS_ID), update: useUpdateView(JOBS_ID) }),
      { wrapper: databaseWrapper({ client }) },
    );
    const viewName = (viewId: Id) =>
      result.current.meta.data?.views.find((v) => v.id === viewId)?.name;
    return { client, result, viewName };
  }

  it('shows quick changes at once and sends them one at a time', async () => {
    const { client, result, viewName } = setup();
    const first = deferred<SettingsAnswer>();
    const second = deferred<SettingsAnswer>();
    client.updateView.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await waitFor(() => expect(result.current.meta.data).toBeDefined());

    act(() => {
      result.current.update.mutate({ viewId: VIEWS.table, change: { name: 'Open jobs' } });
      result.current.update.mutate({ viewId: VIEWS.board, change: { name: 'Jobs by status' } });
    });
    await waitFor(() => expect(viewName(VIEWS.board)).toBe('Jobs by status'));
    expect(viewName(VIEWS.table)).toBe('Open jobs');
    // The second change waits for the first one's answer (and the version it brings).
    expect(client.updateView).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(renamed(2, { [VIEWS.table]: 'Open jobs' }));
      await first.promise;
    });
    await waitFor(() => expect(client.updateView).toHaveBeenCalledTimes(2));
    expect(client.updateView).toHaveBeenLastCalledWith(JOBS_ID, VIEWS.board, {
      name: 'Jobs by status',
    });
    // Still waiting on the second answer: both changes stay shown.
    expect(result.current.meta.data?.version).toBe(2);
    expect(viewName(VIEWS.board)).toBe('Jobs by status');

    const both = renamed(3, { [VIEWS.table]: 'Open jobs', [VIEWS.board]: 'Jobs by status' });
    client.getDatabase.mockResolvedValue(both);
    await act(async () => {
      second.resolve(both);
      await second.promise;
    });
    await waitFor(() => expect(result.current.meta.data?.version).toBe(3));
    expect(viewName(VIEWS.table)).toBe('Open jobs');
    expect(viewName(VIEWS.board)).toBe('Jobs by status');
  });

  it('puts the view back when the server refuses, and reloads after a conflict', async () => {
    const { client, result, viewName } = setup();
    client.updateView
      .mockRejectedValueOnce(new ApiError(403, 'forbidden', "You don't have access to this."))
      .mockRejectedValueOnce(new ApiError(409, 'conflict', CONFLICT));
    await waitFor(() => expect(result.current.meta.data).toBeDefined());
    const before = viewName(VIEWS.table);
    const rename = () =>
      result.current.update
        .mutateAsync({ viewId: VIEWS.table, change: { name: 'Open jobs' } })
        .catch(() => undefined);

    await act(rename);
    await waitFor(() => expect(viewName(VIEWS.table)).toBe(before));

    const loads = client.getDatabase.mock.calls.length;
    await act(rename);
    await waitFor(() => expect(client.getDatabase.mock.calls.length).toBeGreaterThan(loads));
    await waitFor(() => expect(viewName(VIEWS.table)).toBe(before));
    expect(result.current.update.error).toMatchObject({ status: 409, message: CONFLICT });
  });

  it('shows Lock structure at once; sub-items show with the answer and their properties', async () => {
    const client = mockClient();
    const answer = deferred<SettingsAnswer>();
    client.updateDatabase.mockReturnValueOnce(answer.promise);
    const { result } = renderHook(
      () => ({ meta: useDatabase(JOBS_ID), update: useUpdateDatabase(JOBS_ID) }),
      { wrapper: databaseWrapper({ client }) },
    );
    await waitFor(() => expect(result.current.meta.data).toBeDefined());

    act(() => result.current.update.mutate({ locked: true, subItems: true }));
    await waitFor(() => expect(result.current.meta.data?.locked).toBe(true));
    await waitFor(() =>
      expect(client.updateDatabase).toHaveBeenCalledWith(JOBS_ID, { locked: true, subItems: true }),
    );
    expect(result.current.meta.data?.subItems).toBeUndefined();

    const subItems = { parentPropertyId: 'prop-parent', childrenPropertyId: 'prop-children' };
    const saved = { ...jobsDatabase({ version: 2 }), locked: true, subItems };
    client.getDatabase.mockResolvedValue(saved);
    await act(async () => {
      answer.resolve(saved);
      await answer.promise;
    });
    await waitFor(() => expect(result.current.meta.data?.subItems).toEqual(subItems));
    expect(result.current.meta.data?.locked).toBe(true);
  });
});

describe('options typed into cells', () => {
  const urgent: SelectOption = { id: 'typed-urgent', name: 'Urgent', color: 'orange' };
  const high: SelectOption = { id: 'typed-high', name: 'HIGH', color: 'blue' };
  const sentNames = (client: MockClient) => {
    const config = client.updateProperty.mock.lastCall?.[2].config;
    return config?.type === 'select' ? config.options.map((o) => o.name) : [];
  };

  it('adds them to the property, and tries once more after a conflict', async () => {
    const client = mockClient();
    client.updateProperty.mockRejectedValueOnce(new ApiError(409, 'conflict', CONFLICT));
    const { result } = renderHook(() => useAddOptions(JOBS_ID), {
      wrapper: databaseWrapper({ client }),
    });

    await act(() => result.current.mutateAsync({ propertyId: PROPS.priority, options: [urgent] }));
    expect(client.updateProperty).toHaveBeenCalledTimes(2);
    expect(client.updateProperty).toHaveBeenLastCalledWith(JOBS_ID, PROPS.priority, {
      config: expect.objectContaining({ type: 'select' }),
    });
    expect(sentNames(client)).toEqual(['High', 'Medium', 'Low', 'Urgent']);
    // Loaded for the first try, then again after the conflict.
    expect(client.getDatabase).toHaveBeenCalledTimes(2);
  });

  it("doesn't send a name the property already has", async () => {
    const client = mockClient();
    const { result } = renderHook(() => useAddOptions(JOBS_ID), {
      wrapper: databaseWrapper({ client }),
    });
    await act(() => result.current.mutateAsync({ propertyId: PROPS.priority, options: [high] }));
    expect(client.updateProperty).not.toHaveBeenCalled();
  });

  it('go into the property before the row is saved, with the ids to save', async () => {
    const client = mockClient();
    const { result } = renderHook(() => useUpdateValues(JOBS_ID), {
      wrapper: databaseWrapper({ client }),
    });

    await act(() =>
      result.current.mutateAsync({
        rowId: 'row-sink',
        values: { [PROPS.priority]: 'typed-high', [PROPS.notes]: 'Bring the long wrench' },
        newOptions: { [PROPS.priority]: [high] },
      }),
    );
    // "HIGH" is the property's own "High": nothing to add, and its id is saved.
    expect(client.updateProperty).not.toHaveBeenCalled();
    expect(client.updateRow).toHaveBeenLastCalledWith(JOBS_ID, 'row-sink', {
      [PROPS.priority]: PRIORITY.high,
      [PROPS.notes]: 'Bring the long wrench',
    });

    await act(() =>
      result.current.mutateAsync({
        rowId: 'row-sink',
        values: { [PROPS.priority]: 'typed-urgent' },
        newOptions: { [PROPS.priority]: [urgent] },
      }),
    );
    expect(sentNames(client)).toEqual(['High', 'Medium', 'Low', 'Urgent']);
    expect(client.updateProperty.mock.invocationCallOrder[0]).toBeLessThan(
      client.updateRow.mock.invocationCallOrder[1] ?? 0,
    );
    expect(client.updateRow).toHaveBeenLastCalledWith(JOBS_ID, 'row-sink', {
      [PROPS.priority]: 'typed-urgent',
    });
  });
});

describe('useDuplicateRows', () => {
  it('copies rows one after another, in the order given', async () => {
    const client = mockClient();
    const first = deferred<Row>();
    const copy = (rowId: Id, uniqueNumber: number): Row => ({
      ...(jobsRows().find((r) => r.id === rowId) as Row),
      id: `${rowId}-copy`,
      uniqueNumber,
    });
    client.duplicateRow
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(copy('row-sink', 11));
    const { result } = renderHook(() => useDuplicateRows(JOBS_ID), {
      wrapper: databaseWrapper({ client }),
    });

    let copies: Promise<Row[]> = Promise.resolve([]);
    act(() => {
      copies = result.current.mutateAsync(['row-heater', 'row-sink']);
    });
    await waitFor(() => expect(client.duplicateRow).toHaveBeenCalledTimes(1));
    expect(client.duplicateRow).toHaveBeenCalledWith(JOBS_ID, 'row-heater');

    await act(async () => {
      first.resolve(copy('row-heater', 10));
      await copies;
    });
    expect(client.duplicateRow).toHaveBeenLastCalledWith(JOBS_ID, 'row-sink');
    expect((await copies).map((r) => r.id)).toEqual(['row-heater-copy', 'row-sink-copy']);
  });
});
