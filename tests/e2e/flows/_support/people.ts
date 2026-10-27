/**
 * The fictional people the seed creates (docs/decisions/0007-shared-contracts.md, section 2.5).
 * Their password is in process.env.CAREHUB_SEED_PASSWORD; never write it in a test.
 */
export const people = {
  admin: { role: 'admin', email: 'avery.admin@example.test' },
  editor: { role: 'editor', email: 'eli.editor@example.test' },
  commenter: { role: 'commenter', email: 'casey.commenter@example.test' },
  viewer: { role: 'viewer', email: 'val.viewer@example.test' },
  /** From the Learning seed: builds courses in Studio. Signs in by email. */
  trainer: { role: 'trainer', email: 'tara.trainer@example.test' },
} as const;

export type PersonKey = keyof typeof people;

/** The roles the core sign-in helper knows by name; other people sign in by their email. */
export const coreRoles: readonly string[] = ['admin', 'editor', 'commenter', 'viewer'];
