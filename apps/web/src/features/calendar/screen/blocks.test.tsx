import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toGridItem } from '../data/adapt';
import { testEvent, testLayer, testRow } from '../data/testItems';
import { layoutAllDayRow } from '../layout';
import { DayButton, ItemBlock, LaneItems } from './blocks';

// Fictional data only. Tuesday, October 27, 2026 in Denver.
const prefs = { timeZone: 'America/Denver', use24h: false };
const meetings = testLayer('meetings');

describe('ItemBlock', () => {
  it('is a button named with the whole item, in its layer colour', () => {
    render(
      <ItemBlock item={toGridItem(testEvent(), meetings, prefs)} style={{}}>
        QA calibration
      </ItemBlock>,
    );
    const block = screen.getByRole('button', {
      name: 'QA calibration, Tuesday, October 27, 10:00 to 11:00 AM, Meetings',
    });
    expect(block).toHaveAttribute('data-testid', 'calendar-event-ev-1');
    expect(block).toHaveClass('bg-purple-bg', 'text-purple-text');
    expect(block).not.toHaveClass('line-through');
  });

  it('shows declined events faded and struck through, and says so', () => {
    const declined = toGridItem(testEvent({ myReply: 'not-going' }), meetings, prefs);
    render(
      <ItemBlock item={declined} style={{}}>
        QA calibration
      </ItemBlock>,
    );
    const block = screen.getByRole('button', { name: /, Not going$/ });
    expect(block).toHaveClass('line-through', 'text-muted');
    expect(block).not.toHaveClass('bg-purple-bg');
  });
});

describe('DayButton', () => {
  it('names the day, marks today and opens the day', () => {
    const onOpenDay = vi.fn();
    render(
      <>
        <DayButton date="2026-10-27" today="2026-10-27" weekday onOpenDay={onOpenDay} />
        <DayButton date="2026-10-28" today="2026-10-27" weekday onOpenDay={onOpenDay} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Tuesday, October 27' })).toHaveAttribute(
      'aria-current',
      'date',
    );
    const tomorrow = screen.getByRole('button', { name: 'Wednesday, October 28' });
    expect(tomorrow).not.toHaveAttribute('aria-current');
    fireEvent.click(tomorrow);
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-28');
  });
});

describe('LaneItems', () => {
  it('draws 3 items a day, then "+N more", which opens that day', () => {
    const days = ['2026-11-05', '2026-11-06'];
    const items = ['Policy review', 'Training due', 'Rota draft', 'Audit prep', 'Fire drill'].map(
      (title, index) =>
        toGridItem(
          testRow({ id: `row-${index}:due`, title, end: '2026-11-06' }),
          testLayer('db-1', { name: 'Policies', color: 'green' }),
          prefs,
        ),
    );
    const onOpenDay = vi.fn();
    render(
      <LaneItems
        row={layoutAllDayRow(items, days, { maxVisible: 3 })}
        top={0}
        laneHeight={24}
        prefs={prefs}
        onOpenDay={onOpenDay}
      />,
    );
    expect(screen.getAllByRole('button', { name: /, Thursday, November 5, All day/ })).toHaveLength(
      3,
    );
    fireEvent.click(screen.getByRole('button', { name: '+2 more on Thursday, November 5' }));
    expect(onOpenDay).toHaveBeenCalledWith('2026-11-05');
    expect(screen.queryByRole('button', { name: /more on Friday/ })).toBeNull();
  });
});
