// The Status page's requests (GET /api/status, GET /api/status/details, POST /api/status/backup).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, api } from '../../lib/api';

/** The page refreshes its data every 30 seconds (ST-09). */
export const REFRESH_MS = 30_000;

const percent = z.number().nullable();

export const publicStatusSchema = z.object({
  status: z.enum(['working', 'some_problems', 'down']),
  uptime: z.object({ percent, days: z.array(z.object({ date: z.string(), percent })) }),
});
export type PublicStatus = z.infer<typeof publicStatusSchema>;
export type DayUptime = PublicStatus['uptime']['days'][number];

const at = z.string();

export const statusDetailsSchema = z.object({
  parts: z.array(
    z.object({
      part: z.enum(['server', 'database', 'files', 'collab', 'jobs', 'calendar']),
      state: z.enum(['ok', 'problem', 'down', 'unknown']),
      message: z.string().nullable(),
      facts: z.record(z.string(), z.unknown()),
      checkedAt: at.nullable(),
    }),
  ),
  backups: z.object({
    setUp: z.boolean(),
    lastGood: z.object({ at, sizeBytes: z.number().nullable() }).nullable(),
    latest: z.object({ at, ok: z.boolean(), reason: z.string().nullable() }).nullable(),
    lastRestoreTest: z.object({ at, ok: z.boolean(), details: z.string().nullable() }).nullable(),
    next: at,
    requested: z.boolean(),
  }),
  incidents: z.array(
    z.object({
      start: at,
      end: at,
      minutes: z.number(),
      cause: z.enum(['update', 'restart', 'unknown']),
    }),
  ),
  version: z.object({ number: z.string(), buildDate: at.nullable(), updatedAt: at.nullable() }),
});
export type StatusDetails = z.infer<typeof statusDetailsSchema>;
export type PartDetails = StatusDetails['parts'][number];

const viewerSchema = z.object({
  user: z.object({ isSiteAdmin: z.boolean(), timeZone: z.string(), use24h: z.boolean() }),
});
/** Who is looking: enough to show times their way and the site admin details. */
export type Viewer = z.infer<typeof viewerSchema>['user'];

/** The signed-in person, or null when signed out (the page works either way). */
export function useViewer() {
  return useQuery({
    queryKey: ['status', 'viewer'],
    queryFn: async ({ signal }): Promise<Viewer | null> => {
      try {
        return (await api.get('/api/auth/me', { schema: viewerSchema, signal })).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** The overall status and uptime, with the days in `timeZone`. */
export function usePublicStatus(timeZone: string, enabled: boolean) {
  return useQuery({
    queryKey: ['status', 'public', timeZone],
    queryFn: ({ signal }) =>
      api.get(`/api/status?tz=${encodeURIComponent(timeZone)}`, {
        schema: publicStatusSchema,
        signal,
      }),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

/** Parts, backups, incidents and the version, for site admins. */
export function useStatusDetails() {
  return useQuery({
    queryKey: ['status', 'details'],
    queryFn: ({ signal }) =>
      api.get('/api/status/details', { schema: statusDetailsSchema, signal }),
    refetchInterval: REFRESH_MS,
  });
}

/** What the person asked for. Both ask for a backup: every backup ends with a restore test. */
export type BackupAsk = 'backup' | 'restore_test';

export function useAskForBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ask: BackupAsk) => {
      await api.post('/api/status/backup');
      return ask;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['status', 'details'] }),
  });
}
