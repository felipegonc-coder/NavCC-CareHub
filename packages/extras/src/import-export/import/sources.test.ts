import { describe, expect, it } from 'vitest';
import { IMPORT_SOURCES, acceptsFileName, importSource } from './sources';

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
    expect(acceptsFileName(evernote, 'notes.zip')).toBe(false);
    expect(evernote.notAccepted).toBe('Pick a .enex file from Evernote.');
    expect(importSource('nope')).toBeUndefined();
  });
});
