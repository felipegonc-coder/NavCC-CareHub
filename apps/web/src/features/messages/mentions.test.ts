import { describe, expect, it } from 'vitest';
import { nameLookup } from './chat-info';
import {
  findMentionQuery,
  insertMention,
  readableText,
  storedText,
  suggestPeople,
} from './mentions';
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

describe('typing a mention', () => {
  it('finds the name typed after an @', () => {
    expect(findMentionQuery('Hi @av', 6)).toEqual({ start: 3, query: 'av' });
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(findMentionQuery('Hi @Avery L', 11)).toEqual({ start: 3, query: 'Avery L' });
  });

  it('ignores email addresses, line breaks and a space straight after the @', () => {
    expect(findMentionQuery('mail sam@example.org', 20)).toBeNull();
    expect(findMentionQuery('@sam\nthanks', 11)).toBeNull();
    expect(findMentionQuery('@ sam', 5)).toBeNull();
    expect(findMentionQuery('no at sign', 10)).toBeNull();
  });

  it('puts the name in with one space after it', () => {
    const at = { start: 3, query: 'av' };
    expect(insertMention('Hi @av', at, 6, 'Avery Lin')).toEqual({
      text: 'Hi @Avery Lin ',
      caret: 14,
    });
    expect(insertMention('Hi @av thanks', at, 6, 'Avery Lin')).toEqual({
      text: 'Hi @Avery Lin thanks',
      caret: 14,
    });
  });

  it('suggests people by the starts of their names, ignoring accents', () => {
    const people = [{ name: 'Avery Lin' }, { name: 'José Ortiz' }, { name: 'Sam Ortiz' }];
    expect(suggestPeople(people, 'or').map((person) => person.name)).toEqual([
      'José Ortiz',
      'Sam Ortiz',
    ]);
    expect(suggestPeople(people, 'jose o')).toEqual([{ name: 'José Ortiz' }]);
    expect(suggestPeople(people, 'lin a')).toEqual([{ name: 'Avery Lin' }]);
    expect(suggestPeople(people, '')).toHaveLength(3);
    expect(suggestPeople(people, 'very')).toEqual([]);
  });
});
