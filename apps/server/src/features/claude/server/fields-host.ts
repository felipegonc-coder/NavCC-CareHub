import type {
  ClaudeFieldAudience,
  ClaudeFieldInput,
  ClaudeFieldSetup,
  ClaudeFieldValue,
} from '@carehub/extras/claude/fields';
import type { Db, Tx } from '../../../db';

// stand-in: the Databases lane's Claude field type (phase 5) and its api.ts (decision 0200:
// readRowText, updateRows). Until Databases calls bindClaudeFieldHost, no property is a Claude
// field, so nothing fills. Each function checks access as the person it's given.

export interface ClaudeField {
  workspaceId: string;
  databaseId: string;
  propertyId: string;
  setup: ClaudeFieldSetup;
  /** Who last saved the setup. Automatic fills run with this person's access. */
  ownerId: string;
  /** Who can see the field's values (its PropertyAccess.see). */
  see: ClaudeFieldAudience;
  /** The properties in setup.uses that still exist, in that order. */
  inputs: ClaudeFieldInput[];
}

/** A row's text as the person sees it. */
export interface ClaudeRowText {
  /** Each used property's value as text, under the property's name. */
  properties: { name: string; text: string }[];
  /** The row page's own text, without synced blocks or linked databases. Only when asked for. */
  content?: string;
}

export interface ClaudeFieldHost {
  /** The Claude field, or null when the property isn't one or its database is in Trash. */
  field(db: Db | Tx, databaseId: string, propertyId: string): Promise<ClaudeField | null>;
  /**
   * The rows of `rowIds` the person may fill now: Can edit on the row and may change the field.
   * Never rows in Trash.
   */
  fillableRows(
    db: Db | Tx,
    input: {
      userId: string;
      databaseId: string;
      propertyId: string;
      rowIds: readonly string[];
    },
  ): Promise<string[]>;
  /** readRowText (decision 0200): null when the person can't see the row. */
  readRowText(
    db: Db | Tx,
    input: { userId: string; rowId: string; propertyIds: readonly string[]; content: boolean },
  ): Promise<ClaudeRowText | null>;
  /**
   * Saves a fill as an edit by the person (updateRows); imports and duplicates never call it. A null
   * value keeps the old text and marks it failed.
   */
  saveFill(
    db: Db | Tx,
    input: {
      databaseId: string;
      propertyId: string;
      rowId: string;
      userId: string;
      value: ClaudeFieldValue | null;
    },
  ): Promise<void>;
}

const none: ClaudeFieldHost = {
  field: async () => null,
  fillableRows: async () => [],
  readRowText: async () => null,
  saveFill: async () => {},
};
let host = none;

export function claudeFieldHost(): ClaudeFieldHost {
  return host;
}

/** Binds the host (Databases, or a test); the returned function unbinds it. */
export function bindClaudeFieldHost(next: ClaudeFieldHost): () => void {
  host = next;
  return () => {
    if (host === next) host = none;
  };
}
