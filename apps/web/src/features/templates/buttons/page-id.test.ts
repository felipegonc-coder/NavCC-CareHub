import { describe, expect, it } from 'vitest';
import { PAGE_ID } from './fixtures';
import { pageIdFromLink, pageIdFromPath } from './page-id';

describe('pageIdFromPath', () => {
  it('reads the page in /p/<id>', () => {
    expect(pageIdFromPath(`/p/${PAGE_ID}`)).toBe(PAGE_ID);
    expect(pageIdFromPath(`/p/${PAGE_ID}/history`)).toBe(PAGE_ID);
  });

  it('is null anywhere else', () => {
    expect(pageIdFromPath('/templates')).toBeNull();
    expect(pageIdFromPath('/p/launch-plan')).toBeNull();
    expect(pageIdFromPath(`/share/${PAGE_ID}`)).toBeNull();
  });
});

describe('pageIdFromLink', () => {
  it('reads a pasted link, a page address or the ID itself', () => {
    expect(pageIdFromLink(` https://care.example.org/p/${PAGE_ID}?view=board `)).toBe(PAGE_ID);
    expect(pageIdFromLink(`/p/${PAGE_ID}#notes`)).toBe(PAGE_ID);
    expect(pageIdFromLink(PAGE_ID)).toBe(PAGE_ID);
  });

  it('is null for anything else', () => {
    expect(pageIdFromLink('')).toBeNull();
    expect(pageIdFromLink('Tickets')).toBeNull();
    expect(pageIdFromLink('https://care.example.org/templates')).toBeNull();
  });
});
