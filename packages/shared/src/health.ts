import { z } from 'zod';

/** Body of `GET /api/health`. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
