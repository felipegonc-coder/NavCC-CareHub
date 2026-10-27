import { describe, expect, it } from 'vitest';
import { richText, type Question } from '../format/index';
import { questionProblems } from './index';

// Fictional content only.
const choice = (correct: boolean[], texts = ['Billing', 'Repairs']): Question => ({
  id: 'q1',
  type: 'single_choice',
  prompt: richText('Who handles refunds?'),
  points: 1,
  options: texts.map((text, i) => ({ id: `o${i + 1}`, text, correct: correct[i] ?? false })),
});

describe('questionProblems', () => {
  it('finds nothing wrong with a finished question', () => {
    expect(questionProblems(choice([true, false]))).toEqual([]);
  });

  it('reports problems as sentences with paths inside the question', () => {
    const question = { ...choice([false, false], ['Billing', ' ']), prompt: richText('') };
    expect(questionProblems(question)).toEqual([
      { path: 'prompt', message: 'Needs question text.' },
      { path: 'options[1].text', message: 'Option 2 needs text.' },
      { path: 'options', message: 'Has no correct answer.' },
    ]);
    expect(questionProblems(choice([true, true]))).toEqual([
      {
        path: 'options',
        message: 'Has more than one correct answer; use multiple choice instead.',
      },
    ]);
  });

  it('uses the survey rules when asked', () => {
    expect(questionProblems(choice([false, false]), { survey: true })).toEqual([]);
    const statement: Question = {
      id: 'q2',
      type: 'true_false',
      prompt: richText('Refunds take a week.'),
      points: 1,
      answer: true,
    };
    expect(questionProblems(statement)).toEqual([]);
    expect(questionProblems(statement, { survey: true })).toEqual([
      {
        path: 'type',
        message:
          'Is a true false question, but survey lessons only allow single and multiple choice.',
      },
    ]);
  });

  it('checks blanks, areas and pictures', () => {
    const blanks: Question = {
      id: 'q3',
      type: 'fill_blank',
      prompt: richText('Fill in the team.'),
      points: 1,
      parts: [
        { kind: 'text', text: 'Send refunds to ' },
        { kind: 'blank', id: 'b1', answers: [' '] },
      ],
    };
    expect(questionProblems(blanks)).toEqual([
      { path: 'parts[1].answers', message: 'Blank 1 needs at least one accepted answer.' },
    ]);
    const areas: Question = {
      id: 'q4',
      type: 'hotspot',
      prompt: richText('Click the refund button.'),
      points: 1,
      image: { media: { kind: 'file', fileId: 'file-1' }, alt: '' },
      spots: [
        { id: 's1', shape: 'rect', x: 10, y: 10, width: 20, height: 20, correct: false, label: '' },
      ],
    };
    expect(questionProblems(areas).map((problem) => problem.path)).toEqual([
      'image.alt',
      'spots',
      'spots[0].label',
    ]);
  });

  it("leaves links to lessons to the course's own check", () => {
    const linked = {
      ...choice([true, false]),
      prompt: richText([
        { text: 'See ' },
        { text: 'the refunds lesson', link: { kind: 'lesson', lessonId: 'refunds' } },
      ]),
    } satisfies Question;
    expect(questionProblems(linked)).toEqual([]);
    expect(linked.prompt[0]?.runs[1]?.link).toEqual({ kind: 'lesson', lessonId: 'refunds' });
  });
});
