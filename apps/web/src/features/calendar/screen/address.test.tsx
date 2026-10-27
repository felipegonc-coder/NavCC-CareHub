import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useCalendarAddress } from './address';

const TODAY = '2026-10-27';

/** The hook at `url`, with the address it leaves. */
function open(url: string, phone = false) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ ...useCalendarAddress(TODAY, phone), search: useLocation().search }), {
    wrapper,
  }).result;
}

describe('useCalendarAddress', () => {
  it('shows Week on computers and Day on phones, on today, when the address says nothing', () => {
    expect(open('/calendar').current).toMatchObject({ view: 'week', anchor: TODAY });
    expect(open('/calendar', true).current).toMatchObject({ view: 'day', anchor: TODAY });
  });

  it('reads the view and the date from the address, and ignores ones it does not know', () => {
    expect(open('/calendar?view=month&date=2026-11-05', true).current).toMatchObject({
      view: 'month',
      anchor: '2026-11-05',
    });
    expect(open('/calendar?view=year&date=2026-13-01').current).toMatchObject({
      view: 'week',
      anchor: TODAY,
    });
  });

  it('keeps the view and the date in the address, without the date for today', async () => {
    const address = open('/calendar?date=2026-11-05');
    act(() => address.current.show({ view: 'day' }));
    await waitFor(() =>
      expect(address.current).toMatchObject({
        view: 'day',
        anchor: '2026-11-05',
        search: '?date=2026-11-05&view=day',
      }),
    );

    act(() => address.current.show({ date: '2026-11-12' }));
    await waitFor(() => expect(address.current.search).toBe('?date=2026-11-12&view=day'));

    act(() => address.current.show({ date: TODAY }));
    await waitFor(() =>
      expect(address.current).toMatchObject({ view: 'day', anchor: TODAY, search: '?view=day' }),
    );
  });
});
