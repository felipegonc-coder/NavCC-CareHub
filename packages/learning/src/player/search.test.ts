import { describe, expect, it } from 'vitest';
import type { Course } from '../format/index';
import { learnerCourse } from '../quiz/index';
import {
  buildCourseSearchIndex,
  searchCourse,
  searchCourseIndex,
  type SearchSnippetPart,
} from './search';
import { helpDesk, rt } from './test-course';

const places = (query: string, course: Course = helpDesk) =>
  searchCourse(course, query).hits.map((hit) =>
    hit.blockId ? `${hit.lessonId}/${hit.blockId}` : hit.lessonId,
  );
const joined = (parts: readonly SearchSnippetPart[]) => parts.map((part) => part.text).join('');
const marked = (parts: readonly SearchSnippetPart[]) =>
  parts.filter((part) => part.match).map((part) => part.text);

describe('searchCourse', () => {
  it('ignores case and accents, both in the text and in the query', () => {
    expect(places('resume')).toEqual(['l-refunds']);
    expect(places('RÉSUMÉ')).toEqual(['l-refunds']);
    expect(places('réfund window')).toEqual(['l-refunds/b-ref-tip', 'l-refunds/b-ref-check']);
  });

  it('returns hits in course order with the lesson, block, a link and a snippet', () => {
    const result = searchCourse(helpDesk, 'escalat');
    expect(result.tooShort).toBe(false);
    expect(result.total).toBe(5);
    expect(places('escalat')).toEqual([
      'l-greet/b-greet-p',
      'l-esc',
      'l-esc/b-esc-p',
      'l-esc/b-esc-quotes',
      'l-quiz',
    ]);
    expect(result.hits[2]).toEqual({
      lessonId: 'l-esc',
      lessonNumber: 3,
      lessonTitle: 'Escalations',
      blockId: 'b-esc-p',
      link: { kind: 'lesson', lessonId: 'l-esc', blockId: 'b-esc-p' },
      snippet: [
        { text: 'Escalat', match: true },
        { text: 'e to a team lead when a customer asks twice.', match: false },
      ],
      matches: 1,
    });
    expect(result.hits[1]).toMatchObject({
      lessonId: 'l-esc',
      link: { kind: 'lesson', lessonId: 'l-esc' },
    });
    expect(result.hits[1]?.blockId).toBeUndefined();
  });

  it('finds words across formatted runs of rich text', () => {
    const [hit] = searchCourse(helpDesk, 'can help today').hits;
    expect(hit?.blockId).toBe('b-greet-p');
    expect(marked(hit?.snippet ?? [])).toEqual(['can', 'help', 'today']);
  });

  it('needs every word in the same place, in any order', () => {
    expect(places('purchase refund')).toEqual(['l-refunds/b-ref-tip']);
    expect(places('refund escalation')).toEqual(['l-quiz']);
    expect(places('refund twice')).toEqual([]);
  });

  it('counts every match of every word in a place', () => {
    const [hit] = searchCourse(helpDesk, 'refund').hits.filter(
      (candidate) => candidate.blockId === 'b-ref-tip',
    );
    expect(hit?.matches).toBe(2);
  });

  it('cuts a short snippet around the first match at word boundaries, with ellipses', () => {
    const [hit] = searchCourse(helpDesk, 'minute decides').hits;
    expect(hit?.blockId).toBe('b-greet-long');
    const text = joined(hit?.snippet ?? []);
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(124);
    expect(text).toContain('first minute decides how');
    expect(text).not.toContain('Every call');
    expect(marked(hit?.snippet ?? [])).toEqual(['minute', 'decides']);
    expect(text.startsWith('… ')).toBe(false);
    expect(text.endsWith(' …')).toBe(false);
  });

  it('keeps the original accents and spelling in the snippet', () => {
    const [hit] = searchCourse(helpDesk, 'resume of').hits;
    expect(hit?.snippet).toEqual([
      { text: 'Résumé', match: true },
      { text: ' ', match: false },
      { text: 'of', match: true },
      { text: ' the refund policy', match: false },
    ]);
  });

  it('searches what learners read in tables, transcripts, pictures, code, quotes, buttons and practice questions', () => {
    expect(places('pro-rated')).toEqual(['l-refunds/b-ref-table']);
    expect(places('credit note')).toEqual(['l-refunds/b-ref-video']);
    expect(places('refund form on screen')).toEqual(['l-refunds/b-ref-image']);
    expect(places('step 1 open')).toEqual(['l-refunds/b-ref-image']);
    expect(places('greeting_script')).toEqual(['l-greet/b-greet-code']);
    expect(places('rosa delgado')).toEqual(['l-greet/b-greet-quote']);
    expect(places('sam okafor')).toEqual(['l-esc/b-esc-quotes']);
    expect(places('open the refund lesson')).toEqual(['l-esc/b-esc-button']);
    expect(places('within 30 days')).toEqual(['l-refunds/b-ref-tip', 'l-refunds/b-ref-check']);
    expect(places('signed')).toEqual(['l-refunds/b-ref-blank']);
    expect(places('dana whitfield')).toEqual(['l-refunds/b-ref-scenario']);
    expect(places('technical questions')).toEqual(['l-esc/b-esc-cols']);
    expect(places('match their pace')).toEqual(['l-greet/b-greet-list']);
  });

  it('never gives away answers, feedback, scenario scenes, quiz questions or decorative pictures', () => {
    for (const secret of [
      'zebra',
      'okapi',
      'pelican',
      'giraffe',
      'flamingo',
      'happy customer',
      'walrus',
      'swirl',
    ]) {
      expect(places(secret)).toEqual([]);
    }
  });

  it('searches quiz lessons by title and intro', () => {
    expect(places('check your knowledge')).toEqual(['l-quiz']);
    expect(places('five questions')).toEqual(['l-quiz']);
  });

  it('finds the same in the learner view, whose quiz lessons have no questions', () => {
    const learner = learnerCourse(helpDesk);
    for (const query of ['five questions', 'refund', 'escalat']) {
      expect(searchCourse(learner, query)).toEqual(searchCourse(helpDesk, query));
    }
  });

  it('ignores punctuation at the edges of words and repeated words', () => {
    expect(places('refund?')).toEqual(places('refund'));
    expect(places('“twice”')).toEqual(['l-esc/b-esc-p']);
    expect(places('twice twice')).toEqual(['l-esc/b-esc-p']);
  });

  it('finds nothing for queries that are too short', () => {
    for (const query of ['', '   ', 'a', '?!', '5%']) {
      expect(searchCourse(helpDesk, query)).toEqual({ hits: [], total: 0, tooShort: true });
    }
    expect(searchCourse(helpDesk, 'zz').tooShort).toBe(false);
  });

  it('stops at the limit but still counts every hit', () => {
    const index = buildCourseSearchIndex(helpDesk);
    const all = searchCourseIndex(index, 'refund');
    const limited = searchCourseIndex(index, 'refund', { limit: 2 });
    expect(all.total).toBeGreaterThan(2);
    expect(limited.hits).toEqual(all.hits.slice(0, 2));
    expect(limited.total).toBe(all.total);
  });

  it('handles decomposed accents, ligatures and emoji without splitting characters', () => {
    const course: Course = {
      ...helpDesk,
      lessons: [
        {
          id: 'l-1',
          kind: 'content',
          title: 'Odds and ends',
          blocks: [
            { id: 'b-1', type: 'paragraph', text: rt('Cafe\u0301 o\uFB03ce 🎉 party') },
            {
              id: 'b-2',
              type: 'paragraph',
              text: rt(`${'🎉'.repeat(60)}xneedle${'🎉'.repeat(60)}`),
            },
          ],
        },
      ],
    };
    const [cafe] = searchCourse(course, 'cafe office').hits;
    expect(marked(cafe?.snippet ?? [])).toEqual(['Cafe\u0301', 'o\uFB03ce']);
    const [emoji] = searchCourse(course, 'needle').hits;
    const text = joined(emoji?.snippet ?? []);
    expect(marked(emoji?.snippet ?? [])).toEqual(['needle']);
    expect(text.startsWith('…🎉')).toBe(true);
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text),
    ).toBe(false);
  });
});
