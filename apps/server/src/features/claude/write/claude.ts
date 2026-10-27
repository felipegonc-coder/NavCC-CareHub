// What writing help needs from Claude's server API (docs/extras/claude.md, "Server API"). That API
// isn't on main yet (Extras builder 8), so these are stand-ins that send nothing: every request is
// refused as not set up, and every feature counts as off. Tests bind fakes. When ../index.ts lands,
// these become its askClaude, isClaudeFeatureOn and ClaudeError.
import {
  CLAUDE_ERROR_REASONS,
  CLAUDE_ERRORS,
  type ClaudeErrorReason,
  type ClaudeFeature,
} from '@carehub/extras/claude';
import { httpError, type HttpError } from '../../../core/errors';
import type { Db, Tx } from '../../../db';

/** Text the server loaded by ID after the access check, never text a client says is a page's. */
export interface ClaudeDocument {
  title: string;
  text: string;
}

export interface AskClaudeInput {
  workspaceId: string;
  userId: string;
  feature: ClaudeFeature;
  system: string;
  instruction: string;
  documents?: ClaudeDocument[];
  /** The person's own selection, from the client. */
  selection?: string;
  /** Lowers the server's largest max_tokens for this request. */
  maxTokens?: number;
}

export interface ClaudeApi {
  askClaude(db: Db | Tx, input: AskClaudeInput): Promise<{ text: string }>;
  isClaudeFeatureOn(db: Db | Tx, workspaceId: string, feature: ClaudeFeature): Promise<boolean>;
}

/** The same shape as ../index.ts's ClaudeError: a reason and its plain words. */
export class ClaudeError extends Error {
  readonly reason: ClaudeErrorReason;

  constructor(reason: ClaudeErrorReason) {
    super(CLAUDE_ERRORS[reason].message);
    this.name = 'ClaudeError';
    this.reason = reason;
  }
}

// stand-in: askClaude and isClaudeFeatureOn from ../index.ts (Extras builder 8). Nothing is sent.
const notSetUp: ClaudeApi = {
  askClaude: async () => {
    throw new ClaudeError('not_set_up');
  },
  isClaudeFeatureOn: async () => false,
};
let api = notSetUp;

/** Binds Claude's API (tests bind a fake); the returned function unbinds it. */
export function bindWriteClaude(next: Partial<ClaudeApi>): () => void {
  const bound = { ...notSetUp, ...next };
  api = bound;
  return () => {
    if (api === bound) api = notSetUp;
  };
}

export function askClaude(db: Db | Tx, input: AskClaudeInput): Promise<{ text: string }> {
  return api.askClaude(db, input);
}

export function isClaudeFeatureOn(
  db: Db | Tx,
  workspaceId: string,
  feature: ClaudeFeature,
): Promise<boolean> {
  return api.isClaudeFeatureOn(db, workspaceId, feature);
}

/** The reason of a ClaudeError (this file's or ../index.ts's), or undefined for other errors. */
export function claudeErrorReason(error: unknown): ClaudeErrorReason | undefined {
  if (!(error instanceof Error) || !('reason' in error)) return undefined;
  const { reason } = error;
  return CLAUDE_ERROR_REASONS.find((known) => known === reason);
}

/** The answer for a refused or failed request: CLAUDE_ERRORS[reason], with `details: { reason }`. */
export function claudeHttpError(reason: ClaudeErrorReason): HttpError {
  const { status, code, message } = CLAUDE_ERRORS[reason];
  return httpError(status, code, message, { reason });
}
