import { describe, expect, it } from 'vitest';
import { FormPage } from './form-page';
import { routes } from './routes';

describe('Forms routes', () => {
  it('opens the form page at /forms/:code, loading it lazily', async () => {
    expect(routes.map((route) => route.path)).toEqual(['forms/:code']);
    const lazy = routes[0]?.lazy;
    if (typeof lazy !== 'function') throw new Error('The form link should load its page lazily.');
    expect((await lazy()).Component).toBe(FormPage);
  });
});
