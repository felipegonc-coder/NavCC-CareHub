import { MyLearningResponseSchema } from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { api } from '../data';
import { retryOnce } from '../player/data';

export const myLearningKey = ['learning', 'me'] as const;

/** GET /me (docs/learning/api.md): the signed-in person's courses, in My learning's sections. */
export function useMyLearning() {
  return useQuery({
    queryKey: myLearningKey,
    queryFn: ({ signal }) => api('GET', '/me', MyLearningResponseSchema, { signal }),
    retry: retryOnce,
  });
}
