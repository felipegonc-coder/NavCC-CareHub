import { PathReportResponseSchema, type Id } from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { api, apiPath } from '../../data';
import { retryOnce } from '../../player/data';
import { reportsKey } from '../people/data';

/** GET /reports/paths/:id: how everyone on a learning path is getting on. */
export function usePathReport(pathId: Id) {
  return useQuery({
    queryKey: [...reportsKey, 'paths', pathId],
    queryFn: ({ signal }) =>
      api('GET', apiPath('reports', 'paths', pathId), PathReportResponseSchema, { signal }),
    retry: retryOnce,
  });
}
