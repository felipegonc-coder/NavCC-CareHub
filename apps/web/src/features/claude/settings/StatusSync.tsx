import { claudeStatusSchema } from '@carehub/extras/claude/settings';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../../../lib/api';
import { ALL_OFF, setClaudeStatus } from './status';

export const STATUS_KEY = ['claude', 'status'] as const;
/** A feature switched off is gone from every open tab within this (CL-05). */
export const STATUS_EVERY_MS = 5_000;

/**
 * In the shell's overlays: keeps the Claude status up to date and draws nothing. Hidden tabs stop
 * asking and ask again when they're back. Any failure (signed out, offline, an old server) counts
 * as all off.
 */
export function StatusSync() {
  const { data, isError } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) => api.get('/api/claude/status', { schema: claudeStatusSchema, signal }),
    refetchInterval: STATUS_EVERY_MS,
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    setClaudeStatus(data && !isError ? data : ALL_OFF);
  }, [data, isError]);

  useEffect(() => () => setClaudeStatus(ALL_OFF), []);

  return null;
}
