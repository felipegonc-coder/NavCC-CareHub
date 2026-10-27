// Stand-in until features/auth exports usePermission() (decision 0007, section 5.2, ETA Oct 28).
// Then this file goes and the import switches.
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface Me {
  member: { permissions: readonly string[] } | null;
}

/** Whether the person's role has the permission, such as 'pages.create'. */
export function usePermission(key: string): boolean {
  const { data } = useQuery({
    queryKey: ['pages', 'me'],
    queryFn: async () => (await api.get('/api/auth/me')) as Me,
    staleTime: 5 * 60_000,
  });
  return data?.member?.permissions.includes(key) ?? false;
}
