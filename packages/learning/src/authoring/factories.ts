import { HttpsUrlSchema, LIMITS, LinkUrlSchema, newId as randomId } from '../format/index';
import type {
  BlockType,
  ButtonTarget,
  Image,
  MediaRef,
  Question,
  QuestionType,
  RichText,
} from '../format/index';
import type { BlockOf, IdGen, QuestionOf } from './types';

// New blocks and questions start with empty text (editors show hints) and with the smallest structure publish
// checks accept: two tabs, two options and so on. Drafts must pass the schema, so a block that needs a picture,
// media, file or address can only be made once the author has picked one (see `blockNeed`).

/** What the add-block menu must ask for before the block can be made (null when nothing). */
export type BlockNeed = 'image' | 'video' | 'audio' | 'file' | 'embed' | 'link';

/** The picture, media, file or address picked for a block that needs one. */
export type BlockSeed = {
  /** Image, labeled graphic and hotspot questions. */
  image?: Image;
  /** Video and audio. */
  media?: MediaRef;
  /** File download. */
  file?: { fileId: string; name: string };
  /** Web embed (https only), or a button that opens a link (https or mailto). */
  url?: string;
  /** A button's target, when it goes somewhere other than a link. */
  target?: ButtonTarget;
};

const NEEDS: Partial<Record<BlockType, BlockNeed>> = {
  image: 'image',
  labeled_graphic: 'image',
  video: 'video',
  audio: 'audio',
  file: 'file',
  embed: 'embed',
  button: 'link',
};

/** What must be picked before adding a block of `type` (a knowledge check with `questionType`), or null. */
export function blockNeed(type: BlockType, questionType?: QuestionType): BlockNeed | null {
  if (type === 'knowledge_check') return questionType === 'hotspot' ? 'image' : null;
  return NEEDS[type] ?? null;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined)
    throw new Error(`Pick ${what} first; this block can't be added without one.`);
  return value;
}

function checkedUrl(url: string | undefined, https: boolean): string {
  const value = required(url, 'an address');
  if (!(https ? HttpsUrlSchema : LinkUrlSchema).safeParse(value).success) {
    throw new Error(
      https ? 'Use a full https:// address.' : 'Use a full https:// or mailto: address.',
    );
  }
  return value;
}

const none = (): RichText => [];
const times = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);

type Maker<T> = (id: IdGen, seed: BlockSeed) => T;
type BlockMakers = { [T in BlockType]: Maker<Omit<BlockOf<T>, 'id'>> };

const BLOCKS: BlockMakers = {
  heading: () => ({ type: 'heading', level: 2, text: '' }),
  paragraph: () => ({ type: 'paragraph', text: none() }),
  list: (id) => ({ type: 'list', style: 'bulleted', items: [{ id: id(), text: none() }] }),
  callout: () => ({ type: 'callout', tone: 'note', text: none() }),
  statement: () => ({ type: 'statement', text: '' }),
  quote: () => ({ type: 'quote', text: '' }),
  quote_carousel: (id) => ({
    type: 'quote_carousel',
    quotes: times(2, () => ({ id: id(), text: '' })),
  }),
  two_column: () => ({ type: 'two_column', left: none(), right: none() }),
  divider: () => ({ type: 'divider', style: 'line' }),
  code: () => ({ type: 'code', code: '' }),
  table: () => ({ type: 'table', headerRow: true, rows: times(2, () => ['', '']) }),
  image: (_, seed) => ({ type: 'image', image: required(seed.image, 'an image'), size: 'medium' }),
  gallery: () => ({ type: 'gallery', layout: 'carousel', images: [] }),
  labeled_graphic: (_, seed) => ({
    type: 'labeled_graphic',
    image: required(seed.image, 'an image'),
    markers: [],
  }),
  video: (_, seed) => ({ type: 'video', media: required(seed.media, 'a video'), title: '' }),
  audio: (_, seed) => ({ type: 'audio', media: required(seed.media, 'an audio file'), title: '' }),
  file: (_, seed) => {
    const file = required(seed.file, 'a file');
    return { type: 'file', fileId: file.fileId, name: file.name.slice(0, LIMITS.title) };
  },
  embed: (_, seed) => ({ type: 'embed', url: checkedUrl(seed.url, true), title: '' }),
  accordion: (id) => ({ type: 'accordion', items: [{ id: id(), title: '', body: none() }] }),
  tabs: (id) => ({ type: 'tabs', tabs: times(2, () => ({ id: id(), title: '', body: none() })) }),
  timeline: (id) => ({
    type: 'timeline',
    items: times(2, () => ({ id: id(), label: '', title: '' })),
  }),
  process: (id) => ({
    type: 'process',
    steps: times(2, () => ({ id: id(), title: '', body: none() })),
  }),
  flashcards: (id) => ({ type: 'flashcards', cards: [{ id: id(), front: '', back: '' }] }),
  sorting: (id) => {
    const categories = times(2, () => ({ id: id(), title: '' }));
    return {
      type: 'sorting',
      categories,
      items: categories.map((c) => ({ id: id(), text: '', categoryId: c.id })),
    };
  },
  button: (_, seed) => ({
    type: 'button',
    label: '',
    target: seed.target ?? { kind: 'url', url: checkedUrl(seed.url, false) },
  }),
  continue: () => ({ type: 'continue', requires: 'click' }),
  knowledge_check: (id, seed) => ({
    type: 'knowledge_check',
    question: newQuestion('single_choice', id, seed),
    allowRetry: true,
  }),
  scenario: (id) => {
    const start = id();
    return {
      type: 'scenario',
      title: '',
      characters: [],
      startSceneId: start,
      scenes: [{ id: start, text: '', choices: [] }],
    };
  },
};

/**
 * A new block of any of the 28 types with a fresh id, empty text and the smallest structure publish checks
 * accept. Throws when the type needs something picked first (`blockNeed`) and `seed` doesn't have it.
 */
export function newBlock<T extends BlockType>(
  type: T,
  newId: IdGen = randomId,
  seed: BlockSeed = {},
): BlockOf<T> {
  return { id: newId(), ...BLOCKS[type](newId, seed) } as BlockOf<T>;
}

/** A knowledge-check block holding a new question of `questionType` (hotspot needs `seed.image`). */
export function newKnowledgeCheck(
  questionType: QuestionType,
  newId: IdGen = randomId,
  seed: BlockSeed = {},
): BlockOf<'knowledge_check'> {
  return {
    id: newId(),
    type: 'knowledge_check',
    question: newQuestion(questionType, newId, seed),
    allowRetry: true,
  };
}

type QuestionMakers = {
  [T in QuestionType]: Maker<Omit<QuestionOf<T>, 'id' | 'prompt' | 'points'>>;
};

const choices = (id: IdGen) => times(2, () => ({ id: id(), text: '', correct: false }));
const pairs = (id: IdGen) => times(2, () => ({ id: id(), prompt: '', match: '' }));

const QUESTIONS: QuestionMakers = {
  single_choice: (id) => ({ type: 'single_choice', options: choices(id) }),
  multiple_choice: (id) => ({ type: 'multiple_choice', options: choices(id) }),
  true_false: () => ({ type: 'true_false', answer: true }),
  matching: (id) => ({ type: 'matching', pairs: pairs(id) }),
  drag_matching: (id) => ({ type: 'drag_matching', pairs: pairs(id) }),
  fill_blank: (id) => ({
    type: 'fill_blank',
    parts: [
      { kind: 'text', text: '' },
      { kind: 'blank', id: id(), answers: [''] },
    ],
  }),
  ordering: (id) => ({ type: 'ordering', items: times(2, () => ({ id: id(), text: '' })) }),
  hotspot: (_, seed) => ({ type: 'hotspot', image: required(seed.image, 'an image'), spots: [] }),
};

/** A new question of any of the 8 types with a fresh id, 1 point and empty text (hotspot needs `seed.image`). */
export function newQuestion<T extends QuestionType>(
  type: T,
  newId: IdGen = randomId,
  seed: BlockSeed = {},
): QuestionOf<T> {
  return {
    id: newId(),
    prompt: none(),
    points: 1,
    ...QUESTIONS[type](newId, seed),
  } as QuestionOf<T>;
}

/**
 * Turns a question into another type, keeping its id, prompt, points, feedback and picture (a hotspot's picture
 * stays as the question's picture; turning into a hotspot uses the question's picture or `seed.image`).
 * Single and multiple choice keep their options (single choice keeps only the first right answer), the two
 * matching types keep their pairs, and choice options and ordering items carry over as each other (none marked right).
 */
export function changeQuestionType(
  question: Question,
  type: QuestionType,
  newId: IdGen = randomId,
  seed: BlockSeed = {},
): Question {
  if (question.type === type) return question;
  const { id, prompt, points, image, feedback } = question;
  const base = { id, prompt, points, ...(feedback ? { feedback } : {}) };
  if (type === 'hotspot')
    return { ...base, type, image: required(image ?? seed.image, 'an image'), spots: [] };
  const kept = { ...base, ...(image ? { image } : {}) };
  const items =
    question.type === 'single_choice' || question.type === 'multiple_choice'
      ? question.options.map(({ id: itemId, text }) => ({ id: itemId, text }))
      : question.type === 'ordering'
        ? question.items
        : null;
  switch (type) {
    case 'single_choice':
    case 'multiple_choice': {
      if (question.type === 'single_choice' || question.type === 'multiple_choice') {
        let seen = false;
        const options = question.options.map((o) => {
          const correct = o.correct && (type === 'multiple_choice' || !seen);
          seen ||= correct;
          return o.correct === correct ? o : { ...o, correct };
        });
        return { ...kept, type, options };
      }
      const options = items
        ? items.slice(0, LIMITS.options).map((item) => ({ ...item, correct: false }))
        : choices(newId);
      return { ...kept, type, options };
    }
    case 'matching':
    case 'drag_matching':
      return {
        ...kept,
        type,
        pairs:
          question.type === 'matching' || question.type === 'drag_matching'
            ? question.pairs
            : pairs(newId),
      };
    case 'ordering':
      return {
        ...kept,
        type,
        items: items
          ? items.slice(0, LIMITS.orderingItems)
          : times(2, () => ({ id: newId(), text: '' })),
      };
    default:
      return { ...newQuestion(type, newId), ...kept };
  }
}
