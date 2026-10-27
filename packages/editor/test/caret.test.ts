import { describe, expect, it } from 'vitest';
import { renderCaret } from '../src/extensions';

const caretColor = (color: unknown) =>
  renderCaret({ name: 'Robin', color }).style.getPropertyValue('--ch-caret');

describe('carets', () => {
  it('take a design kit color name or a plain CSS color', () => {
    expect(caretColor('blue')).toBe('rgb(var(--ch-blue-text))');
    expect(caretColor('#2563eb')).toBe('#2563eb');
    expect(caretColor('rgb(37, 99, 235)')).toBe('rgb(37, 99, 235)');
  });

  it('ignore any other color', () => {
    for (const color of ['red; background: url(x)', 'var(--ch-fg)', 'Blue', 42, undefined]) {
      expect(caretColor(color)).toBe('currentColor');
    }
  });

  it('show the name as text only', () => {
    const caret = renderCaret({ name: '<b>Robin</b>', color: 'blue' });
    expect(caret.textContent).toContain('<b>Robin</b>');
    expect(caret.querySelector('b')).toBeNull();
  });
});
