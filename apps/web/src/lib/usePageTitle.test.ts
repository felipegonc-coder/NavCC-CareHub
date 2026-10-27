import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePageTitle } from './usePageTitle';

describe('usePageTitle', () => {
  it('puts the screen name after Care Hub', () => {
    renderHook(() => usePageTitle('Messages'));
    expect(document.title).toBe('Care Hub · Messages');
  });

  it('gives just Care Hub without a name', () => {
    document.title = 'Something else';
    renderHook(() => usePageTitle());
    expect(document.title).toBe('Care Hub');
  });

  it('follows a changing name', () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: 'Calendar' },
    });
    rerender({ title: 'Meetings' });
    expect(document.title).toBe('Care Hub · Meetings');
  });
});
