import { describe, expect, it } from 'vitest';
import { bestPassages } from './passages';

describe('bestPassages', () => {
  const filler = (n: number) => `Line ${n} about the team picnic and parking.`;
  const page = [
    ...Array.from({ length: 40 }, (_, n) => filler(n)),
    'Refunds take 3 working days once the refund form is in.',
    ...Array.from({ length: 40 }, (_, n) => filler(n + 40)),
    'Gift cards are never refunded.',
    ...Array.from({ length: 40 }, (_, n) => filler(n + 80)),
  ].join('\n');

  it('sends a short page whole', () => {
    expect(bestPassages('Refunds take 3 days.', ['refunds'], 100)).toBe('Refunds take 3 days.');
  });

  it('sends the blocks with the most search words, in page order', () => {
    const text = bestPassages(page, ['refunds', 'gift', 'long'], 200);
    expect(text).toBe(
      'Refunds take 3 working days once the refund form is in.\n…\nGift cards are never refunded.',
    );
    expect(text.length).toBeLessThanOrEqual(200);
  });

  it('sends the start of the page when only its title matched', () => {
    expect(bestPassages(page, ['payroll'], 50)).toBe(page.slice(0, 50));
  });

  it('cuts one long block around its first match', () => {
    const block = `${'Parking rules. '.repeat(100)}Refunds take 3 days. ${'More parking. '.repeat(100)}`;
    const text = bestPassages(block, ['refunds'], 120);
    expect(text).toHaveLength(120);
    expect(text).toContain('Refunds take 3 days.');
  });
});
