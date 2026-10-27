// Stand-ins until @carehub/shared exports these names (decision 0007, sections 3.3 and 4.1).
// When it does, this file goes and the imports switch to '@carehub/shared'.
export const ACCESS_LEVELS = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const atLeast = (level: AccessLevel, min: AccessLevel): boolean =>
  ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(min);

/** Pages, databases and rows all open at /p/<id>. */
export const pageUrl = (id: string): string => `/p/${id}`;
