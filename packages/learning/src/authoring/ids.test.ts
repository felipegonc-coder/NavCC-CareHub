import { describe, expect, it } from 'vitest';
import type { Course } from '../format/index';
import { courseIds, lessonIds, uniqueIds, withFreeIds, withFreshIds } from './ids';

const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

// A small fictional course with links that point at lessons and blocks.
const course: Course = {
  formatVersion: 1,
  id: 'c1',
  title: 'Greeting new members',
  type: 'standard',
  settings: {
    lessonOrder: 'free',
    completion: { requireAllLessons: true, requireQuizPass: false, requireAcknowledgement: false },
    catalog: { listed: true },
    certificate: { enabled: false },
  },
  lessons: [
    {
      id: 'l1',
      kind: 'content',
      title: 'Say hello',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          text: [
            { runs: [{ text: 'Next: ', link: { kind: 'lesson', lessonId: 'l2', blockId: 'b2' } }] },
          ],
        },
        {
          id: 'b3',
          type: 'knowledge_check',
          allowRetry: true,
          question: { id: 'q1', type: 'true_false', prompt: [], points: 1, answer: true },
        },
      ],
    },
    {
      id: 'l2',
      kind: 'content',
      title: 'Follow up',
      blocks: [
        { id: 'b2', type: 'button', label: 'Back', target: { kind: 'lesson', lessonId: 'l1' } },
      ],
    },
  ],
};

describe('ids', () => {
  it('lists every lesson, block and question id', () => {
    expect([...courseIds(course)]).toEqual(['l1', 'b1', 'b3', 'q1', 'l2', 'b2']);
    const [, second] = course.lessons;
    expect(second && lessonIds(second)).toEqual(['l2', 'b2']);
  });

  it('never hands out an id that is taken', () => {
    const taken = new Set(['n1', 'n2']);
    const gen = uniqueIds(taken, counter());
    expect([gen(), gen()]).toEqual(['n3', 'n4']);
    expect(taken.has('n4')).toBe(true);
    expect(() => uniqueIds(new Set(['x']), () => 'x')()).toThrow();
  });

  it('gives copies fresh ids and re-points links at the copies', () => {
    const copy = withFreshIds(course.lessons, courseIds(course), counter());
    expect(copy.map((l) => l.id)).toEqual(['n1', 'n5']);
    const [first, second] = copy;
    if (first?.kind !== 'content' || second?.kind !== 'content')
      throw new Error('expected content lessons');
    expect(first.blocks[0]).toMatchObject({
      id: 'n2',
      text: [{ runs: [{ link: { kind: 'lesson', lessonId: 'n5', blockId: 'n6' } }] }],
    });
    expect(first.blocks[1]).toMatchObject({ id: 'n3', question: { id: 'n4' } });
    expect(second.blocks[0]).toMatchObject({
      id: 'n6',
      target: { kind: 'lesson', lessonId: 'n1' },
    });
    expect(course.lessons[0]?.id).toBe('l1');
  });

  it('keeps an item as it is when its ids are free', () => {
    const block = { id: 'b9', type: 'divider', style: 'line' } as const;
    expect(withFreeIds(block, ['b9'], courseIds(course))).toBe(block);
    expect(withFreeIds(block, ['b9'], new Set(['b9']), counter('x'))).toEqual({
      ...block,
      id: 'x1',
    });
  });
});
