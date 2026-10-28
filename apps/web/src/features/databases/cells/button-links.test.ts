import { afterEach, describe, expect, it, vi } from 'vitest';
import { openButtonLink } from './button-links';

describe('openButtonLink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an http or https link in a new tab that has no way back', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openButtonLink('https://bluepine.example/jobs/17')).toBe(true);
    expect(openButtonLink('http://bluepine.example')).toBe(true);
    expect(open).toHaveBeenNthCalledWith(
      1,
      'https://bluepine.example/jobs/17',
      '_blank',
      'noopener,noreferrer',
    );
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('opens nothing for any other address', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const refused: unknown[] = [
      'javascript:alert(1)',
      'data:text/html,hello',
      '//bluepine.example',
      '/api/files/file-1',
      'bluepine.example',
      '',
      42,
    ];
    for (const url of refused) expect(openButtonLink(url)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
