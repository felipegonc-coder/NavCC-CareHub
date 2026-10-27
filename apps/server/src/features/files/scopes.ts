import type { CurrentUser } from '@carehub/shared';
import type { Db } from '../../db';
import type { CurrentMember } from '../workspaces';

/** What a scope's checks get: the database, the person, their membership, and the scope's own ID. */
export interface FileScopeContext {
  db: Db;
  user: CurrentUser;
  member: CurrentMember;
  /** The part after the first colon of `<feature>:<id>`, for example a page ID. Check its format. */
  scopeId: string;
}

/** Who may open and who may add a feature's files. Both are asked on every request. */
export interface FileScope {
  canRead: (ctx: FileScopeContext) => boolean | Promise<boolean>;
  canWrite: (ctx: FileScopeContext) => boolean | Promise<boolean>;
}

const FEATURE = /^[a-z][a-z0-9-]{0,39}$/;
const scopes = new Map<string, FileScope>();

/**
 * Makes `feature` the owner of uploads with `scope=<feature>:<id>` (decision 0007, section 4.3). Call it
 * when the feature's routes are registered; registering the same feature again replaces its checks.
 */
export function registerFileScope(feature: string, scope: FileScope): void {
  if (!FEATURE.test(feature)) throw new Error(`"${feature}" can't be a file scope.`);
  scopes.set(feature, scope);
}

export const hasFileScope = (feature: string): boolean => scopes.has(feature);

/** Whether the person may open (`read`) or add and delete (`write`) files there. Unknown scopes: never. */
export async function canUseFileScope(
  mode: 'read' | 'write',
  feature: string,
  ctx: FileScopeContext,
): Promise<boolean> {
  const scope = scopes.get(feature);
  if (!scope) return false;
  return (await (mode === 'read' ? scope.canRead(ctx) : scope.canWrite(ctx))) === true;
}
