import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '../../live';
import { setLiveClientForTest } from '../../live/client';
import { createFakeLive, flush } from '../../live/testSource';
import { databaseKeys } from '../hooks';
import { liveTopic, staleQueries, useDatabaseLive, whenWritesSettle } from './live';

const DB = 'db-jobs';

/** A cache holding each kind of query the database's screens make. */
function filledCache(): QueryClient {
  const queryClient = new QueryClient();
  const keys = [
    databaseKeys.meta(DB),
    databaseKeys.query(DB, 'view-all-jobs', null, ''),
    databaseKeys.chart(DB, 'view-chart', null),
    databaseKeys.row(DB, 'row-sink'),
    databaseKeys.row(DB, 'row-heater'),
    databaseKeys.pick(DB, 'sink'),
  ];
  for (const key of keys) queryClient.setQueryData(key, {});
  return queryClient;
}

function label(key: readonly unknown[]): string {
  return key[2] === 'row' ? `row ${String(key[3])}` : String(key[2]);
}

function staleFor(event: LiveEvent): string[] | null {
  const predicate = staleQueries(event);
  if (!predicate) return null;
  return filledCache()
    .getQueryCache()
    .findAll({ predicate })
    .map((query) => label(query.queryKey))
    .sort();
}

function invalidated(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => label(query.queryKey))
    .sort();
}

/** A write to the database that's on its way until `finish` is called. */
function startWrite(queryClient: QueryClient, databaseId = DB) {
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = new MutationObserver(queryClient, {
    mutationKey: databaseKeys.rowWrites(databaseId),
    mutationFn: () => done,
  });
  void write.mutate();
  return () => finish();
}

describe('staleQueries', () => {
  it('reloads everything after a schema change or a reconnect', () => {
    const everything = ['chart', 'meta', 'pick', 'query', 'row row-heater', 'row row-sink'];
    expect(staleFor({ type: 'schema-changed' })).toEqual(everything);
    expect(staleFor({ type: 'live-reconnected' })).toEqual(everything);
  });

  it('reloads the rows, charts and the pages of the rows named when rows change', () => {
    expect(staleFor({ type: 'rows-changed', data: { rowIds: ['row-sink'] } })).toEqual([
      'chart',
      'pick',
      'query',
      'row row-sink',
    ]);
  });

  it('reloads every row page when the event names no rows (row access rules)', () => {
    expect(staleFor({ type: 'rows-changed' })).toEqual([
      'chart',
      'pick',
      'query',
      'row row-heater',
      'row row-sink',
    ]);
  });

  it('ignores other events', () => {
    expect(staleFor({ type: 'job-updated' })).toBeNull();
  });
});

describe('whenWritesSettle', () => {
  it("runs at once when none of this tab's writes to the database are on their way", () => {
    const queryClient = new QueryClient();
    startWrite(queryClient, 'db-other');
    const runs: string[] = [];
    whenWritesSettle(queryClient, DB, () => runs.push('reload'));
    expect(runs).toEqual(['reload']);
  });

  it('waits for the writes on their way, then runs once', async () => {
    const queryClient = new QueryClient();
    const finish = startWrite(queryClient);
    const runs: string[] = [];
    whenWritesSettle(queryClient, DB, () => runs.push('reload'));
    await flush();
    expect(runs).toEqual([]);
    finish();
    await waitFor(() => expect(runs).toEqual(['reload']));

    // It has stopped watching: a later write doesn't run it again.
    startWrite(queryClient)();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(runs).toEqual(['reload']);
  });
});

describe('useDatabaseLive', () => {
  let live: ReturnType<typeof createFakeLive>;

  beforeEach(() => {
    live = createFakeLive();
    setLiveClientForTest(live.client);
  });

  afterEach(() => {
    setLiveClientForTest(null);
  });

  function Live() {
    useDatabaseLive(DB);
    return null;
  }

  function show(queryClient: QueryClient) {
    return render(
      <QueryClientProvider client={queryClient}>
        <Live />
      </QueryClientProvider>,
    );
  }

  it("follows the database's topic and reloads what an event changes", async () => {
    const queryClient = filledCache();
    show(queryClient);
    await live.open();
    expect(live.subscribed.has(liveTopic(DB))).toBe(true);

    live.send({ type: 'rows-changed', data: { rowIds: ['row-sink'] } }, liveTopic(DB));
    await waitFor(() =>
      expect(invalidated(queryClient)).toEqual(['chart', 'pick', 'query', 'row row-sink']),
    );
  });

  it("waits for this tab's own writes before reloading", async () => {
    const queryClient = filledCache();
    show(queryClient);
    await live.open();
    const finish = startWrite(queryClient);

    live.send({ type: 'schema-changed' }, liveTopic(DB));
    await flush();
    expect(invalidated(queryClient)).toEqual([]);
    finish();
    await waitFor(() => expect(invalidated(queryClient)).toContain('meta'));
  });

  it("shares one reload among the events that come during this tab's writes", async () => {
    const queryClient = filledCache();
    show(queryClient);
    await live.open();
    const finish = startWrite(queryClient);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    live.send({ type: 'rows-changed', data: { rowIds: ['row-sink'] } }, liveTopic(DB));
    live.send({ type: 'rows-changed', data: { rowIds: ['row-heater'] } }, liveTopic(DB));
    await flush();
    expect(invalidate).not.toHaveBeenCalled();
    finish();
    await waitFor(() =>
      expect(invalidated(queryClient)).toEqual([
        'chart',
        'pick',
        'query',
        'row row-heater',
        'row row-sink',
      ]),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('stops following the topic once the database is gone from the screen', async () => {
    const queryClient = filledCache();
    const { unmount } = show(queryClient);
    await live.open();
    unmount();
    await flush();
    expect(live.subscribed.has(liveTopic(DB))).toBe(false);
  });
});
