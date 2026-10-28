import { describe, expect, it } from 'vitest';
import { IMPORT_SOURCES, acceptsFileName, importSource, optionsFor } from './sources';

describe('sources', () => {
  it('lists the sources in the order the Import screen shows them', () => {
    expect(IMPORT_SOURCES.map((source) => source.label)).toEqual([
      'Text and Markdown',
      'HTML',
      'Word',
      'Google Docs',
      'CSV and Excel',
      'Notion export',
      'Evernote',
      'Confluence',
      'Trello',
      'Asana',
    ]);
  });

  it('accepts files by their ending, in any case', () => {
    const evernote = importSource('evernote');
    if (!evernote) throw new Error('no Evernote source');
    expect(acceptsFileName(evernote, 'Notebooks.ENEX')).toBe(true);
    expect(acceptsFileName(evernote, 'notebooks.zip')).toBe(true);
    expect(acceptsFileName(evernote, 'notes.txt')).toBe(false);
    expect(evernote.notAccepted).toBe('Pick a .enex file from Evernote, or a .zip of them.');
    expect(importSource('nope')).toBeUndefined();
  });

  it("offers Evernote's As a database and Trello's Include archived, and keeps only those", () => {
    const options = (id: string) => importSource(id)?.options?.map((option) => option.label);
    expect(options('evernote')).toEqual(['As a database']);
    expect(options('trello')).toEqual(['Include archived']);
    expect(IMPORT_SOURCES.filter((source) => source.options).map((source) => source.id)).toEqual([
      'evernote',
      'trello',
    ]);
    const trello = importSource('trello');
    if (!trello) throw new Error('no Trello source');
    expect(optionsFor(trello, { includeArchived: true, asDatabase: true })).toEqual({
      includeArchived: true,
    });
    expect(optionsFor(trello, { includeArchived: false })).toEqual({});
    expect(optionsFor(trello)).toEqual({});
  });
});
