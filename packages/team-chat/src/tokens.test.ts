import { describe, expect, it } from 'vitest';
import {
  findLinks,
  findMentions,
  mentionToken,
  messagePlainText,
  pageLinkMatcher,
  parseMessageText,
  safeHref,
} from './tokens';

const people: Record<string, { name: string; removed?: boolean }> = {
  'u-avery': { name: 'Avery Lin' },
  'u-sam': { name: 'Sam Ortiz', removed: true },
};
const nameOf = (id: string) => people[id];
const matchPageLink = pageLinkMatcher({
  origins: ['https://carehub.example.com', 'http://192.168.1.20:3000/'],
  pathPrefix: '/p/',
});
const urls = (text: string) => findLinks(text).map((link) => link.url);

describe('mentions', () => {
  it('stores mentions as <@userId>', () => {
    expect(mentionToken('u-avery')).toBe('<@u-avery>');
    expect(mentionToken('123e4567-e89b-42d3-a456-426614174000')).toBe(
      '<@123e4567-e89b-42d3-a456-426614174000>',
    );
    expect(() => mentionToken('not valid')).toThrow('Not a user ID');
  });

  it('finds each mentioned person once, in order', () => {
    expect(findMentions('<@u-sam> and <@u-avery>, again <@u-sam>; not <@ u-x> or <@>')).toEqual([
      'u-sam',
      'u-avery',
    ]);
  });
});

describe('links', () => {
  it('finds http and https links and leaves trailing punctuation out', () => {
    expect(urls('See https://example.com/a?b=1#c. Or HTTP://example.org!')).toEqual([
      'https://example.com/a?b=1#c',
      'HTTP://example.org',
    ]);
    expect(urls('"https://example.net/x", then (https://example.com/y)...')).toEqual([
      'https://example.net/x',
      'https://example.com/y',
    ]);
  });

  it('keeps balanced brackets that belong to the address', () => {
    expect(urls('(see https://example.com/wiki/Tile_(tool))')).toEqual([
      'https://example.com/wiki/Tile_(tool)',
    ]);
  });

  it('accepts ports, IPv6 and international hosts', () => {
    expect(urls('http://localhost:3000/x https://[::1]:8443/ https://bäckerei.example/')).toEqual([
      'http://localhost:3000/x',
      'https://[::1]:8443/',
      'https://bäckerei.example/',
    ]);
  });

  it('ignores lookalikes: no host, "user@" tricks, other schemes, glued to a word', () => {
    expect(urls('https:// http://. https://carehub.example.com@example.org/p/1')).toEqual([]);
    expect(urls('javascript:alert(1) ftp://example.com xhttps://example.com')).toEqual([]);
  });

  it('reports where each link is', () => {
    expect(findLinks('Go: https://example.com.')).toEqual([
      { start: 4, end: 23, url: 'https://example.com' },
    ]);
  });

  it('only passes safe addresses to an href', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('https://example.com/a b')).toBeNull();
    expect(safeHref('https://example.com/"onmouseover="x')).toBeNull();
  });
});

describe('MS-04 Care Hub page links', () => {
  it('reads the page ID from a Care Hub page link', () => {
    expect(matchPageLink('https://carehub.example.com/p/page-qa-form')).toBe('page-qa-form');
    expect(matchPageLink('HTTPS://CareHub.Example.com/p/page-qa-form?view=1#top')).toBe(
      'page-qa-form',
    );
    expect(matchPageLink('http://192.168.1.20:3000/p/page-1/')).toBe('page-1');
  });

  it('ignores other sites, lookalike hosts and other routes', () => {
    expect(matchPageLink('https://example.com/p/page-1')).toBeNull();
    expect(matchPageLink('https://carehub.example.com.example.org/p/page-1')).toBeNull();
    expect(matchPageLink('https://carehub.example.com:8443/p/page-1')).toBeNull();
    expect(matchPageLink('https://carehub.example.com/settings')).toBeNull();
    expect(matchPageLink('https://carehub.example.com/p/')).toBeNull();
  });

  it('needs a route that starts with "/"', () => {
    expect(() => pageLinkMatcher({ origins: [], pathPrefix: 'p/' })).toThrow('pathPrefix');
  });
});

describe('parseMessageText', () => {
  it('splits text into segments in order', () => {
    const text =
      'Hi <@u-avery>, the QA form: https://carehub.example.com/p/qa and https://example.com';
    expect(parseMessageText(text, { matchPageLink })).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'mention', userId: 'u-avery' },
      { type: 'text', text: ', the QA form: ' },
      { type: 'page', url: 'https://carehub.example.com/p/qa', pageId: 'qa' },
      { type: 'text', text: ' and ' },
      { type: 'link', url: 'https://example.com' },
    ]);
  });

  it('keeps tokens for people who were never mentioned as plain text', () => {
    expect(parseMessageText('<@u-avery> <@u-x>', { mentionable: ['u-avery'] })).toEqual([
      { type: 'mention', userId: 'u-avery' },
      { type: 'text', text: ' <@u-x>' },
    ]);
  });

  it('never turns text into markup', () => {
    const text = '<b>bold</b> <img src=x onerror=alert(1)>\nline two';
    expect(parseMessageText(text)).toEqual([{ type: 'text', text }]);
  });

  it('returns nothing for empty text', () => {
    expect(parseMessageText('')).toEqual([]);
  });
});

describe('messagePlainText', () => {
  it('shows mentions as names, including removed and unknown people', () => {
    expect(
      messagePlainText('<@u-avery>, <@u-sam> and <@u-x>: see https://example.com', nameOf),
    ).toBe('@Avery Lin, @Sam Ortiz (removed) and @Unknown person: see https://example.com');
  });
});
