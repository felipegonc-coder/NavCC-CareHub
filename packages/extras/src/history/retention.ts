// How long unnamed page versions are kept: a workspace setting in Data settings (DS-01).
// Named versions are kept until someone removes their name.
import { z } from 'zod';

/** The workspace setting's key. */
export const VERSION_RETENTION_KEY = 'history.versionRetentionDays';

/** Its choices in days; null keeps versions forever. The default is a year (DS-D2). */
export const VERSION_RETENTION_CHOICES = [30, 90, 365, null] as const;
export type VersionRetentionDays = (typeof VERSION_RETENTION_CHOICES)[number];
export const DEFAULT_VERSION_RETENTION_DAYS: VersionRetentionDays = 365;

export const versionRetentionSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(365),
  z.null(),
]);
