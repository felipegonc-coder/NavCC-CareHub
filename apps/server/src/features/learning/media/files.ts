// Stand-in for `registerFileScope` from core's files API (apps/server/src/features/files/index.ts, decision 0007
// section 4.3, due Oct 28). Same names and shape, so switching over is one import line.

/** The person asking: core's `request.user` (only `id` is used here). */
export type FileUser = { id: string };

/** Who may read and add one feature's files. `scopeId` is what follows "<feature>:" in a file's scope. */
export type FileScope = {
  canRead(user: FileUser, scopeId: string): boolean | Promise<boolean>;
  canWrite(user: FileUser, scopeId: string): boolean | Promise<boolean>;
};

const scopes = new Map<string, FileScope>();

/** Makes `feature` decide who may read and add the files scoped "<feature>:<id>". */
export function registerFileScope(feature: string, scope: FileScope): void {
  scopes.set(feature, scope);
}

/** The rules for a scope such as "learning:<courseId>", or undefined if no feature registered it. */
export function fileScopeFor(scope: string): { rules: FileScope; scopeId: string } | undefined {
  const at = scope.indexOf(':');
  const rules = at > 0 ? scopes.get(scope.slice(0, at)) : undefined;
  return rules ? { rules, scopeId: scope.slice(at + 1) } : undefined;
}
