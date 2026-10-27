import type { Property, ViewPropertySetting } from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import { jobsProperties, PROPS } from '../fixtures';
import {
  arrange,
  listProperties,
  matching,
  readWidth,
  withAllShown,
  withColumn,
  withMoved,
  withShown,
} from './properties-model';

const shown = (propertyId: string, width?: number): ViewPropertySetting =>
  width === undefined ? { propertyId, visible: true } : { propertyId, visible: true, width };
const hiddenSetting = (propertyId: string): ViewPropertySetting => ({ propertyId, visible: false });
const names = (properties: readonly Property[]) => properties.map((p) => p.name);

// Name, then Cost and Status shown; Paid listed but hidden; the rest not listed.
const SETTINGS: ViewPropertySetting[] = [
  shown(PROPS.name, 280),
  shown(PROPS.cost, 120),
  hiddenSetting(PROPS.paid),
  shown(PROPS.status),
];

describe('listing the properties', () => {
  it("keeps Name apart, the shown ones in the view's order and the hidden ones in the database's", () => {
    const list = listProperties(jobsProperties(), SETTINGS);
    expect(list.title?.name).toBe('Name');
    expect(names(list.shown)).toEqual(['Cost', 'Status']);
    expect(names(list.hidden)).toEqual(['Priority', 'Due date', 'Technician', 'Paid', 'Notes']);
  });

  it("leaves out the properties the viewer can't see, and ones that are gone", () => {
    const list = listProperties(
      jobsProperties(),
      [shown('prop-gone'), ...SETTINGS],
      [PROPS.name, PROPS.status, PROPS.notes],
    );
    expect(names(list.shown)).toEqual(['Status']);
    expect(names(list.hidden)).toEqual(['Notes']);
  });

  it('finds properties by name, ignoring case', () => {
    expect(names(matching(jobsProperties(), ' DUE '))).toEqual(['Due date']);
    expect(matching(jobsProperties(), '')).toHaveLength(8);
  });
});

describe('changing what the view shows', () => {
  const list = () => listProperties(jobsProperties(), SETTINGS);

  it('shows a property at the end of the shown ones, keeping its settings', () => {
    expect(withShown(list(), SETTINGS, PROPS.paid, true)).toEqual([
      shown(PROPS.name, 280),
      shown(PROPS.cost, 120),
      shown(PROPS.status),
      shown(PROPS.paid),
    ]);
    expect(withShown(list(), SETTINGS, PROPS.notes, true)).toEqual([
      shown(PROPS.name, 280),
      shown(PROPS.cost, 120),
      shown(PROPS.status),
      shown(PROPS.notes),
      hiddenSetting(PROPS.paid),
    ]);
  });

  it('hides a property and keeps its width for when it comes back', () => {
    expect(withShown(list(), SETTINGS, PROPS.cost, false)).toEqual([
      shown(PROPS.name, 280),
      shown(PROPS.status),
      { propertyId: PROPS.cost, visible: false, width: 120 },
      hiddenSetting(PROPS.paid),
    ]);
  });

  it('shows all and hides all, leaving Name alone', () => {
    const all = withAllShown(list(), SETTINGS, true);
    expect(all[0]).toEqual(shown(PROPS.name, 280));
    expect(all.slice(1).map((s) => s.propertyId)).toEqual([
      PROPS.cost,
      PROPS.status,
      PROPS.priority,
      PROPS.due,
      PROPS.technician,
      PROPS.paid,
      PROPS.notes,
    ]);
    expect(all.every((s) => s.visible)).toBe(true);
    expect(withAllShown(list(), SETTINGS, false)).toEqual([
      shown(PROPS.name, 280),
      { propertyId: PROPS.cost, visible: false, width: 120 },
      hiddenSetting(PROPS.status),
      hiddenSetting(PROPS.paid),
    ]);
  });

  it('moves a shown property', () => {
    expect(withMoved(list(), SETTINGS, 1, 0)).toEqual([
      shown(PROPS.name, 280),
      shown(PROPS.status),
      shown(PROPS.cost, 120),
      hiddenSetting(PROPS.paid),
    ]);
  });

  it("keeps the places of properties the panel doesn't list", () => {
    const settings = [shown('prop-secret'), ...SETTINGS];
    const seen = listProperties(jobsProperties(), settings, [
      PROPS.name,
      PROPS.cost,
      PROPS.status,
      PROPS.paid,
    ]);
    expect(withMoved(seen, settings, 0, 1)[0]).toEqual(shown('prop-secret'));
    expect(arrange(settings, [PROPS.status, PROPS.cost], [PROPS.paid])).toEqual([
      shown('prop-secret'),
      shown(PROPS.name, 280),
      shown(PROPS.status),
      { propertyId: PROPS.cost, visible: true, width: 120 },
      hiddenSetting(PROPS.paid),
    ]);
  });
});

describe('table columns', () => {
  it("sets and clears a column's width, and its wrap", () => {
    const wide = withColumn(SETTINGS, PROPS.cost, { width: 320 });
    expect(wide[1]).toEqual(shown(PROPS.cost, 320));
    expect(withColumn(wide, PROPS.cost, { width: undefined })[1]).toEqual(shown(PROPS.cost));
    expect(withColumn(SETTINGS, PROPS.status, { wrap: true })[3]).toEqual({
      propertyId: PROPS.status,
      visible: true,
      wrap: true,
    });
  });

  it("adds Name's setting when the view doesn't list it", () => {
    expect(withColumn([shown(PROPS.cost)], PROPS.name, { width: 300 })).toEqual([
      shown(PROPS.cost),
      shown(PROPS.name, 300),
    ]);
  });

  it('reads typed widths from 80 to 800 px', () => {
    expect(readWidth(' 240 ')).toBe(240);
    expect(readWidth('80')).toBe(80);
    expect(readWidth('800')).toBe(800);
    expect(readWidth('')).toBeUndefined();
    expect(readWidth('79')).toBeNull();
    expect(readWidth('801')).toBeNull();
    expect(readWidth('12.5')).toBeNull();
    expect(readWidth('wide')).toBeNull();
  });
});
