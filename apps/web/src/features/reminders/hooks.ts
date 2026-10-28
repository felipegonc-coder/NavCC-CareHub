import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ApiError } from '../../lib/api';
import { useLiveEvent } from '../live';
import {
  DEFAULT_TIME_SETTINGS,
  pendingForHome,
  remindersApi,
  remindersKeys,
  withoutReminder,
  type NewReminder,
  type PendingReminder,
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

/** The next `limit` pending reminders, soonest first, kept up to date. */
export function usePendingReminders(limit = 5): UseQueryResult<PendingReminder[], ApiError> {
  const select = useCallback((list: ReminderList) => pendingForHome(list, limit), [limit]);
  return useReminderList(select);
}

export function useCreateReminder() {
  const queryClient = useQueryClient();
  return useMutation<Reminder, ApiError, NewReminder>({
    mutationFn: (input) => remindersApi.create(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: remindersKeys.list }),
  });
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
        list ? withoutReminder(list, id) : list,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: remindersKeys.list }),
  });
}

const useTimeSettings = () =>
  useQuery({
    queryKey: ['reminders', 'me'],
    queryFn: ({ signal }) => remindersApi.timeSettings(signal),
    staleTime: Infinity,
    retry: false,
  });

/**
 * The person's time zone and 12- or 24-hour setting. A stand-in that reads GET /api/auth/me until
 * the shell's signed-in user hook is on main; the defaults until it answers.
 */
export function useTimePrefs(): TimeSettings {
  return useTimeSettings().data ?? DEFAULT_TIME_SETTINGS;
}

/** The same, but null until it answers (the defaults if it fails), for choosing preset times. */
export function useLoadedTimePrefs(): TimeSettings | null {
  const { data, isError } = useTimeSettings();
  return data ?? (isError ? DEFAULT_TIME_SETTINGS : null);
}
