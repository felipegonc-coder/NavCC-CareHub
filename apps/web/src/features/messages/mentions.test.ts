import { describe, expect, it } from 'vitest';
import { nameLookup } from './chat-info';
import { readableText, storedText } from './mentions';
import { AVERY, people, SAM } from './test-data';

const nameOf = nameLookup({ ...people, 'u-sam-2': { name: 'Sam' } });

describe('mentions while editing', () => {
  it('shows mentions by name and stores them as mentions again', () => {
    const text = `Thanks <@${SAM}> and <@u-sam-2>, see you <@${AVERY}>`;
    const mentions = [SAM, 'u-sam-2', AVERY];
    const readable = readableText(text, mentions, nameOf);
    expect(readable).toBe('Thanks @Sam Ortiz and @Sam, see you @Avery Lin');
    expect(storedText(readable, mentions, nameOf)).toBe(text);
  });

  it('leaves names that were never mentions as text', () => {
    expect(storedText('Hi @Sam Ortiz', [], nameOf)).toBe('Hi @Sam Ortiz');
  });
});
