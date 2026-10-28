import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';
import { CalendarScreen } from './screen/CalendarScreen';

describe('Calendar routes', () => {
  it('has /calendar, loading its screen lazily', async () => {
    expect(routes.map((route) => route.path)).toEqual(['calendar']);
    expect(matchRoutes(routes, '/calendar')?.at(-1)?.route.path).toBe('calendar');
    expect(matchRoutes(routes, '/calendar/unknown')).toBeNull();

    const [route] = routes;
    expect(route?.Component).toBeUndefined();
    if (typeof route?.lazy !== 'function') throw new Error('The calendar route should be lazy.');
    expect((await route.lazy()).Component).toBe(CalendarScreen);
  });
});
