import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, BlockSchema, QUESTION_TYPES } from '../format/index';
import {
  BLOCK_GROUPS,
  blockCatalog,
  newBlockFromCatalog,
  questionCatalog,
  searchBlockCatalog,
} from './catalog';
import { blockNeed } from './factories';

const counter = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('block catalog', () => {
  it('lists every block type once and a knowledge check for each question type', () => {
    const keys = blockCatalog.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...new Set(blockCatalog.map((entry) => entry.type))].sort()).toEqual(
      [...BLOCK_TYPES].sort(),
    );
    expect(
      blockCatalog
        .filter((entry) => entry.type === 'knowledge_check')
        .map((entry) => entry.questionType),
    ).toEqual([...QUESTION_TYPES]);
    expect(questionCatalog.map((entry) => entry.type)).toEqual([...QUESTION_TYPES]);
    for (const entry of blockCatalog) {
      expect(BLOCK_GROUPS).toContain(entry.group);
      expect(entry.need).toBe(blockNeed(entry.type, entry.questionType));
    }
  });

  it('searches labels, descriptions and keywords, ignoring case and accents', () => {
    expect(searchBlockCatalog('')).toHaveLength(blockCatalog.length);
    expect(searchBlockCatalog('VÍDEO').map((entry) => entry.key)).toEqual(['video']);
    expect(searchBlockCatalog('knowledge hotspot').map((entry) => entry.key)).toEqual([
      'knowledge_check:hotspot',
    ]);
    expect(searchBlockCatalog('tip').map((entry) => entry.key)).toContain('callout');
    expect(searchBlockCatalog('zebra crossing')).toEqual([]);
  });

  it('makes a valid block for every entry', () => {
    const seed = {
      image: { media: { kind: 'file' as const, fileId: 'file-1' }, alt: 'Desk' },
      media: { kind: 'file' as const, fileId: 'file-2' },
      file: { fileId: 'file-3', name: 'Guide.pdf' },
      url: 'https://example.org/page',
    };
    for (const entry of blockCatalog) {
      const block = newBlockFromCatalog(entry, counter(), entry.need ? seed : undefined);
      expect(block.type).toBe(entry.type);
      if (entry.questionType && block.type === 'knowledge_check')
        expect(block.question.type).toBe(entry.questionType);
      expect(BlockSchema.safeParse(block).success).toBe(true);
    }
  });
});
