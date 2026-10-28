import type { Aggregate, Id, View, ViewPropertySetting } from '@carehub/databases';
import { tableOptions } from './columns';

type SettingPatch = Partial<Omit<ViewPropertySetting, 'propertyId'>>;

/** The view's property settings with one property's changed (added at the end if it has none). */
export function withSetting(
  settings: readonly ViewPropertySetting[],
  propertyId: Id,
  patch: SettingPatch,
): ViewPropertySetting[] {
  let found = false;
  const next = settings.map((s) => {
    if (s.propertyId !== propertyId) return s;
    found = true;
    return { ...s, ...patch };
  });
  if (!found) next.push({ propertyId, visible: false, ...patch });
  return next;
}

/** Moves a property's setting just before another's; `beforeId` null puts it at the end. */
export function moveSetting(
  settings: readonly ViewPropertySetting[],
  propertyId: Id,
  beforeId: Id | null,
): ViewPropertySetting[] {
  const moving = settings.find((s) => s.propertyId === propertyId);
  if (!moving || beforeId === propertyId) return [...settings];
  const rest = settings.filter((s) => s.propertyId !== propertyId);
  const at = beforeId === null ? -1 : rest.findIndex((s) => s.propertyId === beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  return rest;
}

/** The view's calculations with one property's set ("None" removes it). */
export function withCalculation(
  calculations: View['calculations'],
  propertyId: Id,
  aggregate: Aggregate,
): View['calculations'] {
  const next = { ...calculations };
  if (aggregate === 'none') delete next[propertyId];
  else next[propertyId] = aggregate;
  return next;
}

/** The view's table options with some changed. */
export function withTableOptions(
  view: View,
  patch: Partial<NonNullable<View['table']>>,
): NonNullable<View['table']> {
  return { ...tableOptions(view), ...patch };
}
