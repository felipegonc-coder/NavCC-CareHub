import { z } from 'zod';

/**
 * How learners hear about a new live version (the publish request's `notify`): no notice, a "this course changed"
 * notice (`tell`), or a notice asking them to take it again (`retake`). Progress sends them (progress/on-publish.ts).
 */
export const PUBLISH_NOTIFY = ['none', 'tell', 'retake'] as const;
export const PublishNotifySchema = z.enum(PUBLISH_NOTIFY);
export type PublishNotify = z.infer<typeof PublishNotifySchema>;
