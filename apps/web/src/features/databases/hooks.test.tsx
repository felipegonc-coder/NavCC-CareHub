import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Row } from '@carehub/databases';
import { ApiError } from './api';
import type { ViewData } from './contract';
import { useDatabase, useMoveRow, useTrashRows, useUpdateValues, useViewData } from './hooks';
import {
  databaseWrapper,
  JOBS_ID,
  jobsRows,
  mockClient,
  PROPS,
  queryData,
  STATUS,
  VIEWS,
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
