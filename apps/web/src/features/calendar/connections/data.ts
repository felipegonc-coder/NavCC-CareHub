import {
  CALENDAR_CHANGED,
  calendarChangedSchema,
  connectionResponseSchema,
  connectionsResponseSchema,
  googleConnectResponseSchema,
  type ConnectionPatch,
  type LinkConnect,
} from '@carehub/team-calendar-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../../../lib/api';
import { useLiveEvent } from '../../live';

/** The server's routes for connected calendars (Calendar spec, Connections). */
const BASE = '/api/calendar/connections';
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const connectionsKey = ['calendar', 'connections'] as const;

/** Leaves Care Hub for Google's sign-in screen. Tests replace `open`. */
export const browser = { open: (url: string) => window.location.assign(url) };

/**
 * The person's connected calendars. Sync tells open screens which connected layer changed with a
 * `calendar.changed` live event; the list also refreshes every minute, so "Last synced" stays true.
 */
export function useConnections() {
  const queryClient = useQueryClient();
  useLiveEvent(CALENDAR_CHANGED, (event) => {
    const change = calendarChangedSchema.safeParse(event.data);
    // Without data it's a reconnect, and changes may have been missed.
    if (change.success && !change.data.layerId?.startsWith('connected:')) return;
    void queryClient.invalidateQueries({ queryKey: connectionsKey });
  });
  return useQuery({
    queryKey: connectionsKey,
    queryFn: ({ signal }) => api.get(BASE, { schema: connectionsResponseSchema, signal }),
    refetchInterval: 60_000,
  });
}

/**
 * For the Calendar screen, once: reads the connections that weren't read in the last minute
 * (Calendar spec: also when Calendar opens). Calendars that changed send `calendar.changed`.
 */
export function useRefreshOnOpen() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    api
      .post(`${BASE}/refresh`, undefined, {
        schema: connectionsResponseSchema,
        signal: controller.signal,
      })
      .then((answer) => queryClient.setQueryData(connectionsKey, answer))
      // Calendar still shows what it has; the sync every few minutes catches up.
      .catch(() => undefined);
    return () => controller.abort();
  }, [queryClient]);
}

/** After a change: read the list again. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: connectionsKey });
}

/** Google's sign-in, to connect an account, or with a connection id to reconnect that one. */
export function useConnectGoogle() {
  return useMutation({
    mutationFn: async (connectionId?: string) => {
      const body = connectionId ? { connectionId } : {};
      const { url } = await api.post(`${BASE}/google`, body, {
        schema: googleConnectResponseSchema,
      });
      browser.open(url);
    },
  });
}

/** Subscribes to a private calendar link. */
export function useAddLink() {
  return useMutation({
    mutationFn: (link: LinkConnect) =>
      api.post(`${BASE}/links`, link, { schema: connectionResponseSchema }),
    onSuccess: useRefresh(),
  });
}

/** Renames a connection, or picks which of its calendars show. */
export function useUpdateConnection() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConnectionPatch }) =>
      api.patch(one(id), patch, { schema: connectionResponseSchema }),
    onSuccess: useRefresh(),
  });
}

/** Reads a connection again now: "Sync now", or "Retry" after a problem. */
export function useSyncConnection() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`${one(id)}/sync`, undefined, { schema: connectionResponseSchema }),
    onSuccess: useRefresh(),
  });
}

/** Removes a connection: its calendars, their events in Care Hub and its sign-in or link. */
export function useRemoveConnection() {
  return useMutation({
    mutationFn: (id: string) => api.delete(one(id)),
    onSuccess: useRefresh(),
  });
}
