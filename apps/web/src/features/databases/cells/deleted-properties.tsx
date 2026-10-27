import {
  formatCalendarDate,
  instantToCalendarDate,
  type Id,
  type Instant,
  type Property,
  type Viewer,
} from '@carehub/databases';
import { Button } from '@carehub/ui';
import { useState } from 'react';
import { PROPERTY_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { PropertyTypeIcon } from './type-icon';

/** A property deleted in the last 30 days, which can come back with its values. */
export interface DeletedProperty {
  property: Property;
  deletedAt: Instant;
}

export interface DeletedPropertiesProps {
  deleted: readonly DeletedProperty[];
  actions: Pick<PropertyActions, 'restore'>;
  viewer: Pick<Viewer, 'timeZone'>;
  /** Can edit or Full access with Lock structure off (canChangeProperties). */
  canRestore: boolean;
  onRestored?: (property: Property) => void;
  onError?: (error: unknown) => void;
}

/** Properties → Deleted: each deleted property with the day it went and Restore. */
export function DeletedProperties({
  deleted,
  actions,
  viewer,
  canRestore,
  onRestored,
  onError,
}: DeletedPropertiesProps) {
  const [busy, setBusy] = useState<ReadonlySet<Id>>(new Set());
  if (deleted.length === 0) {
    return <p className="px-2 py-1.5 text-small text-muted">{PROPERTY_TEXT.noDeleted}</p>;
  }

  const restore = async (property: Property) => {
    setBusy((ids) => new Set(ids).add(property.id));
    try {
      await actions.restore(property.id);
      onRestored?.(property);
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy((ids) => {
        const next = new Set(ids);
        next.delete(property.id);
        return next;
      });
    }
  };

  return (
    <ul aria-label={PROPERTY_TEXT.deletedList} className="flex flex-col">
      {deleted.map(({ property, deletedAt }) => (
        <li key={property.id} className="flex items-center gap-2 rounded px-2 py-1.5">
          <PropertyTypeIcon type={property.config.type} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-small text-fg">{property.name}</span>
            <span className="text-label text-muted">
              {PROPERTY_TEXT.deletedOn(
                formatCalendarDate(instantToCalendarDate(deletedAt, viewer.timeZone), 'full'),
              )}
            </span>
          </span>
          {canRestore && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy.has(property.id)}
              aria-label={PROPERTY_TEXT.restoreNamed(property.name)}
              onClick={() => void restore(property)}
            >
              {PROPERTY_TEXT.restore}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
