import { LIMITS } from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import {
  CARD_PREVIEW_LABELS,
  CARD_SIZE_LABELS,
  COLOR_TEXT,
  LAYOUT_TEXT,
  OPEN_MODE_LABELS,
  SUB_ITEMS_LABELS,
  TABS_AS_LABELS,
} from './layout-text';

describe('Layout panel words', () => {
  it('words the view settings', () => {
    expect(LAYOUT_TEXT.readOnly).toBe('Only people who can edit this view change its layout.');
    expect(LAYOUT_TEXT.noSettings).toBe('This layout has no settings here.');
    expect(LAYOUT_TEXT.rows(25)).toBe('25 rows');
    expect(LAYOUT_TEXT.cards(50)).toBe('50 cards per group');
    expect([
      LAYOUT_TEXT.openPagesIn,
      LAYOUT_TEXT.loadLimit,
      LAYOUT_TEXT.showPageIcon,
      LAYOUT_TEXT.wrapText,
      LAYOUT_TEXT.tabsAs,
      LAYOUT_TEXT.wrapCells,
      LAYOUT_TEXT.verticalLines,
    ]).toEqual([
      'Open rows in',
      'Load limit',
      'Show page icons',
      'Wrap text',
      'Show views as',
      'Wrap cells',
      'Show vertical lines',
    ]);
    expect([
      LAYOUT_TEXT.cardPreview,
      LAYOUT_TEXT.cardSize,
      LAYOUT_TEXT.fitImage,
      LAYOUT_TEXT.colorColumns,
      LAYOUT_TEXT.showBy,
      LAYOUT_TEXT.endBy,
      LAYOUT_TEXT.sameProperty,
      LAYOUT_TEXT.noDate,
      LAYOUT_TEXT.showWeekends,
      LAYOUT_TEXT.showTable,
      LAYOUT_TEXT.showDependencies,
      LAYOUT_TEXT.subItems,
      LAYOUT_TEXT.filterSubItems,
      LAYOUT_TEXT.deletedProperty,
    ]).toEqual([
      'Card preview',
      'Card size',
      'Fit image',
      'Color columns',
      'Show by',
      'End date',
      'Same as Show by',
      'No date property',
      'Show weekends',
      'Show table',
      'Show dependencies',
      'Sub-items',
      'Filter sub-items too',
      'This property was deleted.',
    ]);
  });

  it('names the choices in menu order', () => {
    expect(Object.values(OPEN_MODE_LABELS)).toEqual(['Side panel', 'Centered window', 'Full page']);
    expect(Object.values(CARD_PREVIEW_LABELS)).toEqual(['None', 'Page cover', 'Page content']);
    expect(Object.values(CARD_SIZE_LABELS)).toEqual(['Small', 'Medium', 'Large']);
    expect(Object.values(TABS_AS_LABELS)).toEqual(['Tabs', 'Dropdown']);
    expect(Object.values(SUB_ITEMS_LABELS)).toEqual(['Nested', 'Flattened', 'Parents only']);
  });

  it('words conditional color, with the package messages', () => {
    expect(COLOR_TEXT.title).toBe('Conditional color');
    expect(COLOR_TEXT.intro).toBe(
      'Color rows, or one property’s cells, when a condition matches. The first rule that matches wins.',
    );
    expect(COLOR_TEXT.readOnly).toBe('Only people who can edit this view change its color rules.');
    expect([COLOR_TEXT.none, COLOR_TEXT.add, COLOR_TEXT.back]).toEqual([
      'No color rules yet.',
      'Add color rule',
      'Back',
    ]);
    expect([COLOR_TEXT.count(1), COLOR_TEXT.count(3)]).toEqual(['1 rule', '3 rules']);
    expect([COLOR_TEXT.when, COLOR_TEXT.target, COLOR_TEXT.row, COLOR_TEXT.color]).toEqual([
      'When',
      'Apply to',
      'Whole row',
      'Color',
    ]);
    expect([COLOR_TEXT.noCondition, COLOR_TEXT.conditions(2)]).toEqual([
      'No condition yet',
      '2 conditions',
    ]);
    expect([
      COLOR_TEXT.edit(1),
      COLOR_TEXT.move(2),
      COLOR_TEXT.duplicate(3),
      COLOR_TEXT.remove(4),
      COLOR_TEXT.moved(1, 2, 3),
    ]).toEqual([
      'Edit rule 1',
      'Move rule 2',
      'Duplicate rule 3',
      'Delete rule 4',
      'Moved rule 1 to 2 of 3.',
    ]);
    expect([COLOR_TEXT.tooMany, COLOR_TEXT.invalid, COLOR_TEXT.deletedProperty]).toEqual([
      `Up to ${LIMITS.colorRules} rules.`,
      "This color rule isn't valid.",
      'A color rule uses a property that was deleted.',
    ]);
  });
});
