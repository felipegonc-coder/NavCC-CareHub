import { DEFAULT_TIME_PREFS, isValidTimeZone } from '@carehub/team-time';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';
import { api, type ApiError } from '../../lib/api';
import { useLiveEvent } from '../live';
import {
  remindersApi,
  remindersKeys,
  type Reminder,
  type ReminderChange,
  type ReminderList,
} from './api';
import type { TimeSettings } from './format';

/** The person's reminders, refetched when the server says they changed (or after a reconnect). */
export function useReminderList<T = ReminderList>(
  select?: (list: ReminderList) => T,
): UseQueryResult<T, ApiError> {
  const queryClient = useQueryClient();
  useLiveEvent('reminders-changed', () => {
    void queryClient.invalidateQueries({ queryKey: remindersKeys.list });
  });
  return useQuery<ReminderList, ApiError, T>({
    queryKey: remindersKeys.list,
    queryFn: ({ signal }) => remindersApi.list(signal),
    select,
  });
}

/** A pending reminder, for Home's Reminders section. */
export interface PendingReminder {
  id: string;
  type: 'page' | 'event';
  /** Null when the person can't open the page or event any more. */
  title: string | null;
  /** ISO instant. */
  dueAt: string;
  note: string;
  /** The page, or the event in Calendar. */
  href: string;
}

/** The next `limit` pending reminders, soonest first, kept up to date. */
export function usePendingReminders(limit = 5): UseQueryResult<PendingReminder[], ApiError> {
  const select = useCallback(
    (list: ReminderList): PendingReminder[] =>
      list.pending.slice(0, limit).map(({ id, target, title, dueAt, note, href }) => ({
        id,
        type: target.type,
        title,
        dueAt,
        note,
        href,
      })),
    [limit],
  );
  return useReminderList(select);
}

export function useChangeReminder() {
  const queryClient = useQueryClient();
  return useMutation<Reminder, ApiError, { id: string; change: ReminderChange }>({
    mutationFn: ({ id, change }) => remindersApi.update(id, change),
    onSettled: () => queryClient.invalidateQueries({ queryKey: remindersKeys.list }),
  });
}

export function useDeleteReminder() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => remindersApi.remove(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<ReminderList>(remindersKeys.list, (list) =>
        list
          ? {
              pending: list.pending.filter((reminder) => reminder.id !== id),
              sent: list.sent.filter((reminder) => reminder.id !== id),
            }
          : list,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: remindersKeys.list }),
  });
}

const meSchema = z.object({ user: z.object({ timeZone: z.string(), use24h: z.boolean() }) });

/**
 * The person's time zone and 12- or 24-hour setting. A stand-in that reads GET /api/auth/me until
 * the shell's signed-in user hook is on main; the defaults until it answers.
 */
export function useTimePrefs(): TimeSettings {
  const { data } = useQuery({
    queryKey: ['reminders', 'me'],
    queryFn: ({ signal }) => api.get('/api/auth/me', { schema: meSchema, signal }),
    staleTime: Infinity,
    retry: false,
  });
  return data && isValidTimeZone(data.user.timeZone) ? data.user : DEFAULT_TIME_PREFS;
}
