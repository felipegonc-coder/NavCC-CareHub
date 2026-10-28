import defaultTheme from 'tailwindcss/defaultTheme';
import { describe, expect, it } from 'vitest';
import preset from '../tailwind-preset';
import { cn, radii, scaleVariables, spacing, typeScale } from '../src';

describe('scale', () => {
  it("keeps Tailwind's spacing steps", () => {
    const tailwind = defaultTheme.spacing as unknown as Record<string, string>;
    for (const [step, value] of Object.entries(tailwind)) {
      if (step !== '0') expect(spacing[step], `step ${step}`).toBe(value);
    }
    expect(Object.keys(spacing)).toHaveLength(Object.keys(tailwind).length - 1);
  });

  it('writes the sizes as CSS variables', () => {
    const variables = scaleVariables();
    expect(variables).toMatchObject({
      '--ch-radius-sm': '4px',
      '--ch-radius': '8px',
      '--ch-radius-full': '9999px',
      '--ch-space-px': '1px',
      '--ch-space-1_5': '0.375rem',
      '--ch-space-2': '0.5rem',
      '--ch-space-96': '24rem',
      '--ch-text-title': '2.25rem',
      '--ch-leading-title': '2.75rem',
      '--ch-weight-title': '700',
      '--ch-tracking-title': '-0.01em',
      '--ch-text-h1': '1.875rem',
      '--ch-weight-h2': '600',
      '--ch-text-small': '0.875rem',
      '--ch-leading-small': '1.25rem',
      '--ch-weight-semibold': '600',
      '--ch-page-width': '48rem',
      '--ch-sidebar-width': '16rem',
      '--ch-dialog-width': '32rem',
      '--ch-sheet-height': '85dvh',
    });
    expect(variables['--ch-font-mono']).toMatch(/^ui-monospace, SFMono-Regular, /);
    expect(variables['--ch-weight-body']).toBeUndefined();
    for (const name of Object.keys(variables)) expect(name).toMatch(/^--ch-[a-z0-9_-]+$/);
  });

  it('gives the Tailwind classes the same values', () => {
    const { extend } = preset.theme;
    expect(extend.borderRadius).toEqual(radii);
    expect(extend.spacing).toMatchObject(spacing);
    expect(extend.spacing.sidebar).toBe('16rem');
    expect(Object.keys(extend.fontSize)).toEqual(Object.keys(typeScale));
    expect(extend.fontSize.title).toEqual([
      '2.25rem',
      { lineHeight: '2.75rem', fontWeight: '700', letterSpacing: '-0.01em' },
    ]);
    expect(extend.fontSize.h1).toEqual(['1.875rem', { lineHeight: '1.3', fontWeight: '600' }]);
    expect(extend.fontSize.small).toEqual(['0.875rem', { lineHeight: '1.25rem' }]);
    expect(extend.gridTemplateColumns).toEqual({ control: 'auto 1fr' });
    expect(extend.maxHeight).toEqual({ sheet: '85dvh' });
  });

  it('teaches tailwind-merge the new names', () => {
    expect(cn('text-h1', 'text-muted')).toBe('text-h1 text-muted');
    expect(cn('text-body', 'text-h2')).toBe('text-h2');
    expect(cn('z-50', 'z-toast')).toBe('z-toast');
    expect(cn('outline-offset-2', 'outline-offset-inset')).toBe('outline-offset-inset');
    expect(cn('grid-cols-2', 'grid-cols-control')).toBe('grid-cols-control');
    expect(cn('max-h-96', 'max-h-sheet')).toBe('max-h-sheet');
  });
});
