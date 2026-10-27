import { describe, expect, it } from 'vitest';
import { AnalyticsScreen } from './analytics-screen';
import { routes } from './routes';

describe('Analytics route', () => {
  it('is /analytics, with the screen loaded only when it opens', async () => {
    expect(routes).toHaveLength(1);
    const [route] = routes;
    expect(route?.path).toBe('analytics');
    const lazy = route?.lazy;
    if (typeof lazy !== 'function') throw new Error('The Analytics route should load lazily.');
    expect((await lazy()).Component).toBe(AnalyticsScreen);
  });
});
