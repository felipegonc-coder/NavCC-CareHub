import { TeamViewResponseSchema, type Id } from '@carehub/learning';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, apiPath, withQuery } from '../../data';
import { retryOnce } from '../../player/data';
import { reportsKey } from '../people/data';

/**
 * GET /reports/team: the groups and people the viewer may see (their own team for a manager), over
 * every course or only `courseId`. The last course's numbers stay on show while another loads.
 */
export function useTeamView(courseId: Id | undefined) {
  return useQuery({
    queryKey: [...reportsKey, 'team', courseId ?? null],
    queryFn: ({ signal }) =>
      api('GET', withQuery(apiPath('reports', 'team'), { courseId }), TeamViewResponseSchema, {
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: retryOnce,
  });
}
