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

/** The same in a scope registered with `allowAnonymous: true`: null for someone who isn't signed in. */
export interface AnonymousFileScopeContext extends Omit<FileScopeContext, 'user' | 'member'> {
  user: CurrentUser | null;
  member: CurrentMember | null;
}

type Check<Context> = (ctx: Context) => boolean | Promise<boolean>;

/**
 * Who may open and who may add a feature's files. Both are asked on every request. With
 * `allowAnonymous: true` (forms anyone can fill in, under decision 0010's conditions), people who aren't
 * signed in may upload there through POST /api/files/anonymous when `canWrite` agrees; every upload
 * there, from anyone, follows the anonymous rules: no uploader is kept, only some types are taken,
 * pictures are drawn again, files are always downloaded, a daily quota, and files no one claims
 * (claimFiles) within an hour are deleted.
 */
export type FileScope =
  | {
      allowAnonymous?: false;
      canRead: Check<FileScopeContext>;
      canWrite: Check<FileScopeContext>;
    }
  | {
      allowAnonymous: true;
      canRead: Check<AnonymousFileScopeContext>;
      canWrite: Check<AnonymousFileScopeContext>;
    };

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

/** Whether the feature's files follow the anonymous rules (registered with `allowAnonymous: true`). */
export const isAnonymousScope = (feature: string): boolean =>
  scopes.get(feature)?.allowAnonymous === true;

/**
 * Whether the person may open (`read`) or add and delete (`write`) files there. Unknown scopes: never.
 * Someone who isn't signed in: only in anonymous scopes.
 */
export async function canUseFileScope(
  mode: 'read' | 'write',
  feature: string,
  ctx: AnonymousFileScopeContext,
): Promise<boolean> {
  const scope = scopes.get(feature);
  if (!scope) return false;
  if (scope.allowAnonymous === true) {
    return (await (mode === 'read' ? scope.canRead(ctx) : scope.canWrite(ctx))) === true;
  }
  const { user, member } = ctx;
  if (!user || !member) return false;
  const signedIn = { ...ctx, user, member };
  return (await (mode === 'read' ? scope.canRead(signedIn) : scope.canWrite(signedIn))) === true;
}
