import { useMemo } from 'react';
import type { Id } from '@carehub/databases';
import type { NewProperty, PropertyAnswer, PropertyChange, SettingsAnswer } from '../api';
import { useSettingsChange } from '../hooks';

/**
 * The property writes the menu makes. Each answers with the whole database (which replaces the
 * cached one); a type change also says how many values it cleared.
 */
export interface PropertyActions {
  create(property: NewProperty): Promise<SettingsAnswer>;
  /** A new `config` (with a new type) is a type change. */
  update(propertyId: Id, change: PropertyChange): Promise<PropertyAnswer>;
  remove(propertyId: Id): Promise<SettingsAnswer>;
  /** Brings back a deleted property with its values (within 30 days). */
  restore(propertyId: Id): Promise<SettingsAnswer>;
  duplicate(propertyId: Id): Promise<SettingsAnswer>;
}

/** PropertyActions through the database client, as one settings change each. */
export function usePropertyActions(databaseId: Id): PropertyActions {
  const { mutateAsync } = useSettingsChange(databaseId);
  return useMemo(
    () => ({
      create: (property) => mutateAsync((client) => client.createProperty(databaseId, property)),
      update: async (propertyId, change) =>
        // The write's own answer comes back, so a type change keeps its `cleared` count.
        (await mutateAsync((client) =>
          client.updateProperty(databaseId, propertyId, change),
        )) as PropertyAnswer,
      remove: (propertyId) =>
        mutateAsync((client) => client.deleteProperty(databaseId, propertyId)),
      restore: (propertyId) =>
        mutateAsync((client) => client.restoreProperty(databaseId, propertyId)),
      duplicate: (propertyId) =>
        mutateAsync((client) => client.duplicateProperty(databaseId, propertyId)),
    }),
    [databaseId, mutateAsync],
  );
}
