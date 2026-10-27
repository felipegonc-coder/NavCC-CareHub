/**
 * Access levels for spaces, pages, databases and rows, lowest first (decision 0007, section 3.3).
 * 'edit_content' is for databases only.
 */
export const ACCESS_LEVELS = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** What a grant can give: an access level, or 'rows_only' (databases only). */
export type GrantLevel = AccessLevel | 'rows_only';

/** Whether `level` is `min` or higher, for example `atLeast(level, 'edit')`. */
export function atLeast(level: AccessLevel, min: AccessLevel): boolean {
  return ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(min);
}
