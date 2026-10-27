import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, BlockSchema, QUESTION_TYPES, QuestionSchema } from '../format/index';
import type { Question } from '../format/index';
import {
  blockNeed,
  changeQuestionType,
  newBlock,
  newKnowledgeCheck,
  newQuestion,
} from './factories';
import type { BlockSeed } from './factories';

const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

// Fictional media picked in the add-block menu.
const image = { media: { kind: 'file' as const, fileId: 'file-desk' }, alt: 'A tidy help desk' };
const seed: BlockSeed = {
  image,
  media: { kind: 'url', url: 'https://video.example.org/welcome' },
  file: { fileId: 'file-checklist', name: 'Call checklist.pdf' },
  url: 'https://forms.example.org/feedback',
};

describe('newBlock', () => {
  it('makes every block type as a valid draft', () => {
    for (const type of BLOCK_TYPES) {
      const block = newBlock(type, counter(), seed);
      expect(block.type).toBe(type);
      expect(BlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it('starts with empty text and the smallest publishable structure', () => {
    const gen = counter();
    expect(newBlock('paragraph', gen)).toEqual({ id: 'n1', type: 'paragraph', text: [] });
    expect(newBlock('tabs', gen)).toEqual({
      id: 'n2',
      type: 'tabs',
      tabs: [
        { id: 'n3', title: '', body: [] },
        { id: 'n4', title: '', body: [] },
      ],
    });
    const sorting = newBlock('sorting', counter());
    expect(sorting.items.map((item) => item.categoryId)).toEqual(
      sorting.categories.map((c) => c.id),
    );
    const scenario = newBlock('scenario', counter());
    expect(scenario.scenes[0]?.id).toBe(scenario.startSceneId);
  });

  it('says what must be picked first and refuses to make the block without it', () => {
    expect(BLOCK_TYPES.filter((type) => blockNeed(type) !== null)).toEqual([
      'image',
      'labeled_graphic',
      'video',
      'audio',
      'file',
      'embed',
      'button',
    ]);
    expect(blockNeed('knowledge_check', 'hotspot')).toBe('image');
    expect(blockNeed('knowledge_check', 'matching')).toBeNull();
    for (const type of [
      'image',
      'labeled_graphic',
      'video',
      'audio',
      'file',
      'embed',
      'button',
    ] as const) {
      expect(() => newBlock(type)).toThrow();
    }
    expect(() => newBlock('embed', counter(), { url: 'http://example.org' })).toThrow();
    expect(() => newBlock('embed', counter(), { url: 'mailto:help@example.org' })).toThrow();
    expect(newBlock('button', counter(), { url: 'mailto:help@example.org' }).target).toEqual({
      kind: 'url',
      url: 'mailto:help@example.org',
    });
    expect(
      newBlock('button', counter(), { target: { kind: 'lesson', lessonId: 'l2' } }).target,
    ).toEqual({ kind: 'lesson', lessonId: 'l2' });
    expect(
      newBlock('file', counter(), { file: { fileId: 'f1', name: 'x'.repeat(300) } }).name,
    ).toHaveLength(200);
  });
});

describe('newQuestion', () => {
  it('makes every question type as a valid draft, worth 1 point', () => {
    for (const type of QUESTION_TYPES) {
      const question = newQuestion(type, counter(), seed);
      expect(question).toMatchObject({ type, points: 1, prompt: [] });
      expect(QuestionSchema.safeParse(question).success).toBe(true);
    }
    expect(() => newQuestion('hotspot')).toThrow();
  });

  it('wraps a question in a knowledge check', () => {
    const check = newKnowledgeCheck('ordering', counter());
    expect(check).toMatchObject({
      id: 'n1',
      type: 'knowledge_check',
      allowRetry: true,
      question: { id: 'n2', type: 'ordering' },
    });
    expect(BlockSchema.safeParse(check).success).toBe(true);
  });
});

describe('changeQuestionType', () => {
  const prompt = [{ runs: [{ text: 'Which replies sound warm?' }] }];
  const multiple: Question = {
    id: 'q1',
    type: 'multiple_choice',
    prompt,
    points: 3,
    feedback: { correct: [{ runs: [{ text: 'Yes.' }] }] },
    image,
    options: [
      { id: 'a', text: 'Happy to help!', correct: true },
      { id: 'b', text: 'What now?', correct: false },
      { id: 'c', text: 'Thanks for waiting.', correct: true },
    ],
  };

  it('keeps the shared parts and the options between choice types', () => {
    const single = changeQuestionType(multiple, 'single_choice');
    expect(single).toMatchObject({
      id: 'q1',
      type: 'single_choice',
      prompt,
      points: 3,
      feedback: multiple.feedback,
      image,
    });
    expect(single.type === 'single_choice' && single.options.map((o) => o.correct)).toEqual([
      true,
      false,
      false,
    ]);
    expect(changeQuestionType(multiple, 'multiple_choice')).toBe(multiple);
  });

  it('carries options over as ordering items and back', () => {
    const ordering = changeQuestionType(multiple, 'ordering', counter());
    expect(ordering.type === 'ordering' && ordering.items).toEqual([
      { id: 'a', text: 'Happy to help!' },
      { id: 'b', text: 'What now?' },
      { id: 'c', text: 'Thanks for waiting.' },
    ]);
    const back = changeQuestionType(ordering, 'single_choice');
    expect(back.type === 'single_choice' && back.options.every((o) => !o.correct)).toBe(true);
  });

  it('keeps pairs between the matching types and starts fresh otherwise', () => {
    const matching = newQuestion('matching', counter());
    expect(changeQuestionType(matching, 'drag_matching')).toMatchObject({
      type: 'drag_matching',
      pairs: matching.pairs,
    });
    const fill = changeQuestionType(multiple, 'fill_blank', counter());
    expect(fill).toMatchObject({ id: 'q1', type: 'fill_blank', prompt, points: 3 });
    expect(QuestionSchema.safeParse(fill).success).toBe(true);
  });

  it("uses the question's picture for a hotspot and keeps a hotspot's picture", () => {
    const hotspot = changeQuestionType(multiple, 'hotspot');
    expect(hotspot).toMatchObject({ type: 'hotspot', image, spots: [] });
    expect(() => changeQuestionType(newQuestion('true_false'), 'hotspot')).toThrow();
    expect(changeQuestionType(hotspot, 'true_false')).toMatchObject({
      type: 'true_false',
      image,
      answer: true,
    });
    for (const q of [hotspot, changeQuestionType(hotspot, 'matching', counter())])
      expect(QuestionSchema.safeParse(q).success).toBe(true);
  });
});
