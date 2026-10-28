import { ME } from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import { ID, TICKETS } from './fixtures';
import {
  filterName,
  firstValue,
  fromFilter,
  namesFor,
  settableProperties,
  toFilter,
  valueNames,
} from './values';

const property = (id: string) => TICKETS.properties.find((item) => item.id === id)!;

describe('values a button sets', () => {
  it('starts each property with a value it can save', () => {
    expect(settableProperties(TICKETS).map((item) => [item.name, firstValue(item)])).toEqual([
      ['Name', ''],
      ['Status', ID.new],
      ['Tags', []],
      ['Due', { dynamic: 'today' }],
      ['Owner', [ME]],
      ['Hours', ''],
      ['Urgent', true],
      ['Notes', [{ text: '' }]],
    ]);
  });

  it('names the values in the database’s order for the sentence', () => {
    expect(
      valueNames(TICKETS, {
        [ID.notes]: [{ text: 'From the front desk' }],
        [ID.tags]: [ID.chat, ID.phone],
        [ID.urgent]: false,
        [ID.due]: { dynamic: 'now' },
      }),
    ).toEqual([
      'Tags Chat and Phone',
      'Due Now',
      'Urgent unchecked',
      'Notes “From the front desk”',
    ]);
  });

  it('keeps the database, template and values with an Add a row step', () => {
    expect(
      namesFor(
        {
          kind: 'add_row',
          databaseId: TICKETS.id,
          templateId: ID.intake,
          values: { [ID.status]: ID.done },
        },
        TICKETS,
      ),
    ).toEqual({ target: 'Tickets', template: 'Intake', values: ['Status Done'] });
  });
});

describe('the rows Edit rows changes', () => {
  it('reads back the filters it makes', () => {
    const byStatus = fromFilter(toFilter(property(ID.status), ID.done));
    expect(byStatus).toEqual({ propertyId: ID.status, value: ID.done });
    expect(filterName(TICKETS, byStatus!)).toBe('Status is Done');
    expect(fromFilter(toFilter(property(ID.urgent), 'unchecked'))).toEqual({
      propertyId: ID.urgent,
      value: 'unchecked',
    });
    expect(fromFilter(toFilter(property(ID.owner), ME))).toEqual({
      propertyId: ID.owner,
      value: ME,
    });
  });

  it('tells every row from a filter set up elsewhere', () => {
    expect(fromFilter(null)).toBeNull();
    expect(fromFilter({ kind: 'group', id: 'g1', combinator: 'or', children: [] })).toBeUndefined();
  });
});
