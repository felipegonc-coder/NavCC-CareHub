// What store.ts loads for one database (decision 0200): its db_databases row with the page's title,
// icon and place. Plain types and helpers only, so meta.ts and its tests need no database.
import type {
  Id,
  Property,
  RichText,
  RowAccessRule,
  RowPageLayout,
  RowTemplate,
  View,
} from '@carehub/databases';

/** Sub-items: the "Parent item" relation and its two-way "Sub-items" pair. */
export type SubItemSettings = { parentPropertyId: Id; childrenPropertyId: Id };

/** Dependencies: the "Blocked by" and "Blocking" relations, and whether moving a blocker shifts. */
export type DependencySettings = {
  blockedByPropertyId: Id;
  blockingPropertyId: Id;
  shift: 'shift' | 'none';
};

/** A deleted property and its values (row id → value), kept 30 days for restore. */
export type DeletedProperty = {
  property: Property;
  /** ISO time it was deleted. */
  deletedAt: string;
  values: Record<string, unknown>;
};

/** The settings a settings write may change (each a db_databases column). */
export interface DatabaseSettings {
  description: RichText;
  properties: Property[];
  views: View[];
  templates: RowTemplate[];
  accessRules: RowAccessRule[];
  defaultTemplateId: Id | null;
  locked: boolean;
  rowPageLayout: RowPageLayout | null;
  subItems: SubItemSettings | null;
  dependencies: DependencySettings | null;
  deletedProperties: DeletedProperty[];
}

/** One database: its settings, its page's title, icon and place, and its version. */
export interface DatabaseRecord extends DatabaseSettings {
  /** The database page's id. */
  id: string;
  workspaceId: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  /** The page's icon as the pages API stores it. */
  pageIcon: unknown;
  inline: boolean;
  /** The database page is in Trash. */
  inTrash: boolean;
  /** Bumped by every settings write; clients send it back with theirs. */
  version: number;
  nextUniqueNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a uuid (page ids); anything else is never looked up. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** A page icon as DatabaseMeta and Row show it: the emoji, or null for other kinds of icon. */
export function iconText(icon: unknown): string | null {
  if (typeof icon === 'string') return icon || null;
  if (icon && typeof icon === 'object' && 'emoji' in icon) {
    const emoji = (icon as { emoji?: unknown }).emoji;
    return typeof emoji === 'string' && emoji !== '' ? emoji : null;
  }
  return null;
}
