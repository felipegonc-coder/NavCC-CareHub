import { BankListSchema } from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data';

/** TanStack Query keys for question banks, so a save can refresh the lists that show it. */
export const bankKeys = {
  all: ['learning', 'banks'] as const,
};

/** The workspace's question banks, without their questions (`GET /studio/banks`). */
export function useBankList() {
  return useQuery({
    queryKey: bankKeys.all,
    queryFn: ({ signal }) => api('GET', '/studio/banks', BankListSchema, { signal }),
  });
}
