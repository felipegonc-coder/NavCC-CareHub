import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PropertyAnswer } from '../api';
import { databaseKeys } from '../hooks';
import {
  databaseWrapper,
  JOBS_ID,
  jobsDatabase,
  mockClient,
  PROPS,
  testQueryClient,
} from '../test-utils';
import { usePropertyActions } from './property-actions';

describe('usePropertyActions', () => {
  function setup() {
    const client = mockClient();
    const queryClient = testQueryClient();
    const { result } = renderHook(() => usePropertyActions(JOBS_ID), {
      wrapper: databaseWrapper({ client, queryClient }),
    });
    return { client, queryClient, result };
  }

  it('changes a property and keeps the count of values it cleared', async () => {
    const { client, queryClient, result } = setup();
    const changed: PropertyAnswer = { ...jobsDatabase({ version: 2 }), cleared: 1 };
    client.updateProperty.mockResolvedValue(changed);

    let answer: PropertyAnswer | undefined;
    await act(async () => {
      answer = await result.current.update(PROPS.notes, { config: { type: 'text' } });
    });

    expect(client.updateProperty).toHaveBeenCalledWith(JOBS_ID, PROPS.notes, {
      config: { type: 'text' },
    });
    expect(answer?.cleared).toBe(1);
    expect(queryClient.getQueryData(databaseKeys.meta(JOBS_ID))).toEqual(changed);
  });

  it('adds, deletes, restores and duplicates through the client', async () => {
    const { client, result } = setup();
    await act(async () => {
      await result.current.create({ name: 'Invoice', config: { type: 'text' } });
      await result.current.remove(PROPS.cost);
      await result.current.restore(PROPS.cost);
      await result.current.duplicate(PROPS.paid);
    });

    expect(client.createProperty).toHaveBeenCalledWith(JOBS_ID, {
      name: 'Invoice',
      config: { type: 'text' },
    });
    expect(client.deleteProperty).toHaveBeenCalledWith(JOBS_ID, PROPS.cost);
    expect(client.restoreProperty).toHaveBeenCalledWith(JOBS_ID, PROPS.cost);
    expect(client.duplicateProperty).toHaveBeenCalledWith(JOBS_ID, PROPS.paid);
  });
});
