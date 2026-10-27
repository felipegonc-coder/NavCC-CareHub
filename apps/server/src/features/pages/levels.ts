// Stand-in until @carehub/shared exports these names (decision 0007, sections 3.2 and 3.3). When
// it does, this file goes and the imports switch to '@carehub/shared'.
export const ACCESS_LEVELS = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export type GrantLevel = AccessLevel | 'rows_only';
export const atLeast = (level: AccessLevel, min: AccessLevel): boolean =>
  ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(min);
/** For example 'pages.edit' or 'workspace.admin'. */
export type PermissionKey = `${string}.${string}`;
