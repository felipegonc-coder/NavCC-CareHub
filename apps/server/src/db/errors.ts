/**
 * Whether a database error (also when Drizzle wraps it) is a unique violation, optionally of one
 * constraint or unique index.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    const { code, constraint: name, cause } = current as Record<string, unknown>;
    if (code === '23505') return constraint === undefined || name === constraint;
    current = cause;
  }
  return false;
}
