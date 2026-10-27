import type { Block, ScenarioBlock } from './blocks';
import type { ContentLesson, Course, QuizLesson } from './course';
import type { Id, Image, RichText } from './primitives';
import type { Question } from './questions';
import { plainText } from './rich-text';

/** A reason a course can't be published yet. `path` uses the format-issue notation, e.g. `lessons[1].questions[2]`. */
export type PublishProblem = {
  path: string;
  lessonId?: Id;
  blockId?: Id;
  questionId?: Id;
  message: string;
};

type Where = { path: string; label: string; lessonId?: Id; blockId?: Id; questionId?: Id };
type Add = (where: Where, text: string, subPath?: string) => void;

const blank = (value: string | undefined) => !value || value.trim() === '';
const blankRich = (value: RichText | undefined) => plainText(value).trim() === '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything that stops a course from being published, in reading order, as plain-language problems such as
 * `Lesson 2 "Escalations": question 3 has no correct answer.` An empty list means the course can be published.
 * The course must already pass the schema (use `parseCourse` for untrusted input).
 */
export function checkPublishable(course: Course): PublishProblem[] {
  const problems: PublishProblem[] = [];
  const add: Add = (where, text, subPath = '') => {
    const problem: PublishProblem = {
      path: where.path + subPath,
      message: `${where.label} ${text}`,
    };
    if (where.lessonId !== undefined) problem.lessonId = where.lessonId;
    if (where.blockId !== undefined) problem.blockId = where.blockId;
    if (where.questionId !== undefined) problem.questionId = where.questionId;
    problems.push(problem);
  };
  const top: Where = { path: '', label: 'The course' };
  const { settings } = course;

  if (blank(course.title)) add(top, 'needs a title.', 'title');
  if (course.lessons.length === 0) add(top, 'needs at least one lesson.', 'lessons');
  const { requireAllLessons, requireQuizPass, requireAcknowledgement } = settings.completion;
  if (!requireAllLessons && !requireQuizPass && !requireAcknowledgement) {
    add(
      top,
      'needs at least one way to be completed (all lessons, a quiz pass or an acknowledgement).',
      'settings.completion',
    );
  }
  if (
    requireQuizPass &&
    !course.lessons.some((l) => l.kind === 'quiz' && l.settings.mode !== 'survey')
  ) {
    add(
      top,
      'asks for a quiz pass but has no graded quiz lesson.',
      'settings.completion.requireQuizPass',
    );
  }
  if (requireAcknowledgement && blank(settings.acknowledgement?.statement)) {
    add(
      top,
      'asks for an acknowledgement but has no statement to acknowledge.',
      'settings.acknowledgement',
    );
  }
  if (course.cover) checkImage(add, top, course.cover, 'cover', 'cover picture');
  checkLinks(add, top, course.description, course, 'description');

  const lessonIds = new Set<Id>();
  const blockIds = new Set<Id>();
  const questionIds = new Set<Id>();
  course.lessons.forEach((lesson, index) => {
    const title = lesson.title.trim();
    const where: Where = {
      path: `lessons[${index}]`,
      label: title ? `Lesson ${index + 1} "${title}"` : `Lesson ${index + 1}`,
      lessonId: lesson.id,
    };
    if (lessonIds.has(lesson.id))
      add(where, `has the same id as an earlier lesson ("${lesson.id}").`, '.id');
    lessonIds.add(lesson.id);
    if (!title) add(where, 'needs a title.', '.title');
    if (lesson.kind === 'content')
      checkContentLesson(add, where, lesson, course, blockIds, questionIds);
    else checkQuizLesson(add, where, lesson, course, questionIds);
  });
  return problems;
}

function checkContentLesson(
  add: Add,
  where: Where,
  lesson: ContentLesson,
  course: Course,
  blockIds: Set<Id>,
  questionIds: Set<Id>,
) {
  if (lesson.blocks.length === 0) add(where, 'has no blocks.', '.blocks');
  if (lesson.headerImage)
    checkImage(add, where, lesson.headerImage, '.headerImage', 'header picture');
  lesson.blocks.forEach((block, index) => {
    const at: Where = {
      ...where,
      path: `${where.path}.blocks[${index}]`,
      label: `${where.label}: block ${index + 1} (${block.type.replaceAll('_', ' ')})`,
      blockId: block.id,
    };
    if (blockIds.has(block.id))
      add(at, `has the same id as an earlier block ("${block.id}").`, '.id');
    blockIds.add(block.id);
    checkLinks(add, at, block, course);
    if (block.type === 'knowledge_check') {
      const question = block.question;
      const qWhere: Where = { ...at, path: `${at.path}.question`, questionId: question.id };
      if (questionIds.has(question.id))
        add(qWhere, `has the same id as an earlier question ("${question.id}").`, '.id');
      questionIds.add(question.id);
      checkQuestion(add, qWhere, question, false);
    } else checkBlock(add, at, block);
  });
}

function checkQuizLesson(
  add: Add,
  where: Where,
  lesson: QuizLesson,
  course: Course,
  questionIds: Set<Id>,
) {
  const survey = lesson.settings.mode === 'survey';
  const draws = lesson.bankDraws ?? [];
  if (lesson.questions.length === 0 && draws.length === 0)
    add(where, 'has no questions.', '.questions');
  const { poolSize } = lesson.settings;
  if (poolSize !== undefined && poolSize > lesson.questions.length) {
    add(
      where,
      `draws ${plural(poolSize, 'question')} per attempt but has only ${lesson.questions.length}.`,
      '.settings.poolSize',
    );
  }
  checkLinks(add, where, lesson.intro, course, '.intro');
  const inLesson = new Set<Id>();
  lesson.questions.forEach((question, index) => {
    const at: Where = {
      ...where,
      path: `${where.path}.questions[${index}]`,
      label: `${where.label}: question ${index + 1}`,
      questionId: question.id,
    };
    if (questionIds.has(question.id))
      add(at, `has the same id as an earlier question ("${question.id}").`, '.id');
    questionIds.add(question.id);
    inLesson.add(question.id);
    checkLinks(add, at, question, course);
    checkQuestion(add, at, question, survey);
  });
  const banks = new Set<Id>();
  draws.forEach((draw, drawIndex) => {
    const drawWhere: Where = { ...where, path: `${where.path}.bankDraws[${drawIndex}]` };
    if (banks.has(draw.bankId))
      add(
        drawWhere,
        `draws from bank "${draw.bankId}" more than once; use one draw with a bigger count.`,
        '.bankId',
      );
    banks.add(draw.bankId);
    if (!draw.questions) return;
    if (draw.count > draw.questions.length) {
      add(
        drawWhere,
        `draws ${plural(draw.count, 'question')} from bank "${draw.bankId}", which has only ${draw.questions.length}.`,
        '.count',
      );
    }
    draw.questions.forEach((question, index) => {
      const at: Where = {
        ...where,
        path: `${drawWhere.path}.questions[${index}]`,
        label: `${where.label}: question ${index + 1} from bank "${draw.bankId}"`,
        questionId: question.id,
      };
      if (inLesson.has(question.id))
        add(at, `has the same id as another question in this lesson ("${question.id}").`, '.id');
      inLesson.add(question.id);
      checkLinks(add, at, question, course);
      checkQuestion(add, at, question, survey);
    });
  });
}

function checkQuestion(add: Add, where: Where, question: Question, survey: boolean) {
  if (blankRich(question.prompt)) add(where, 'needs question text.', '.prompt');
  if (question.image) checkImage(add, where, question.image, '.image');
  if (survey && question.type !== 'single_choice' && question.type !== 'multiple_choice') {
    add(
      where,
      `is a ${question.type.replaceAll('_', ' ')} question, but survey lessons only allow single and multiple choice.`,
      '.type',
    );
    return;
  }
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice': {
      const { options } = question;
      if (options.length < 2) add(where, 'needs at least 2 options.', '.options');
      uniqueIds(add, where, options, '.options', 'options');
      needText(
        add,
        where,
        options,
        (option) => blank(option.text),
        (i) => [`option ${i + 1} needs text.`, `.options[${i}].text`],
      );
      if (survey) break;
      const correct = options.filter((option) => option.correct).length;
      if (correct === 0) add(where, 'has no correct answer.', '.options');
      else if (question.type === 'single_choice' && correct > 1)
        add(where, 'has more than one correct answer; use multiple choice instead.', '.options');
      break;
    }
    case 'true_false':
      break;
    case 'matching':
    case 'drag_matching':
      if (question.pairs.length < 2) add(where, 'needs at least 2 pairs.', '.pairs');
      uniqueIds(add, where, question.pairs, '.pairs', 'pairs');
      needText(
        add,
        where,
        question.pairs,
        (pair) => blank(pair.prompt) || blank(pair.match),
        (i) => [`pair ${i + 1} needs both sides.`, `.pairs[${i}]`],
      );
      break;
    case 'fill_blank': {
      const seen = new Set<Id>();
      let blanks = 0;
      question.parts.forEach((part, i) => {
        if (part.kind !== 'blank') return;
        blanks++;
        if (seen.has(part.id))
          add(where, `has two blanks with the id "${part.id}".`, `.parts[${i}].id`);
        seen.add(part.id);
        if (!part.answers.some((answer) => !blank(answer)))
          add(where, `blank ${blanks} needs at least one accepted answer.`, `.parts[${i}].answers`);
      });
      if (blanks === 0) add(where, 'needs at least one blank.', '.parts');
      break;
    }
    case 'ordering':
      if (question.items.length < 2)
        add(where, 'needs at least 2 items to put in order.', '.items');
      uniqueIds(add, where, question.items, '.items', 'items');
      needText(
        add,
        where,
        question.items,
        (item) => blank(item.text),
        (i) => [`item ${i + 1} needs text.`, `.items[${i}].text`],
      );
      break;
    case 'hotspot':
      if (!question.spots.some((spot) => spot.correct))
        add(where, 'has no correct area.', '.spots');
      uniqueIds(add, where, question.spots, '.spots', 'areas');
      needText(
        add,
        where,
        question.spots,
        (spot) => blank(spot.label),
        (i) => [
          `area ${i + 1} needs a label for keyboard and screen-reader users.`,
          `.spots[${i}].label`,
        ],
      );
      break;
  }
}

/** Adds a problem for every item that `isMissing` flags; `say` gives the message and sub-path for item i. */
function needText<T>(
  add: Add,
  where: Where,
  items: readonly T[],
  isMissing: (item: T) => boolean,
  say: (i: number) => [string, string],
) {
  items.forEach((item, i) => {
    if (isMissing(item)) add(where, ...say(i));
  });
}

function checkBlock(add: Add, at: Where, block: Exclude<Block, { type: 'knowledge_check' }>) {
  const atLeast = (items: readonly unknown[], min: number, what: string, subPath: string) => {
    if (items.length < min) add(at, `needs at least ${plural(min, what)}.`, subPath);
  };
  switch (block.type) {
    case 'heading':
    case 'statement':
      if (blank(block.text)) add(at, 'needs text.', '.text');
      break;
    case 'paragraph':
    case 'callout':
      if (blankRich(block.text)) add(at, 'needs text.', '.text');
      break;
    case 'quote':
      if (blank(block.text)) add(at, 'needs text.', '.text');
      if (block.background) checkImage(add, at, block.background, '.background');
      break;
    case 'code':
      if (blank(block.code)) add(at, 'needs code.', '.code');
      break;
    case 'two_column':
      if (blankRich(block.left) && blankRich(block.right))
        add(at, 'needs text in at least one column.', '.left');
      break;
    case 'divider':
    case 'continue':
      break;
    case 'table': {
      const width = block.rows[0]?.length ?? 0;
      if (block.rows.some((row) => row.length !== width))
        add(at, 'needs the same number of cells in every row.', '.rows');
      break;
    }
    case 'list':
      atLeast(block.items, 1, 'item', '.items');
      uniqueIds(add, at, block.items, '.items', 'items');
      needText(
        add,
        at,
        block.items,
        (item) => blankRich(item.text),
        (i) => [`item ${i + 1} needs text.`, `.items[${i}].text`],
      );
      break;
    case 'quote_carousel':
      atLeast(block.quotes, 2, 'quote', '.quotes');
      uniqueIds(add, at, block.quotes, '.quotes', 'quotes');
      needText(
        add,
        at,
        block.quotes,
        (quote) => blank(quote.text),
        (i) => [`quote ${i + 1} needs text.`, `.quotes[${i}].text`],
      );
      break;
    case 'image':
      checkImage(add, at, block.image, '.image');
      break;
    case 'gallery':
      atLeast(block.images, 2, 'picture', '.images');
      block.images.forEach((image, i) =>
        checkImage(add, at, image, `.images[${i}]`, `picture ${i + 1}`),
      );
      break;
    case 'labeled_graphic':
      checkImage(add, at, block.image, '.image');
      uniqueIds(add, at, block.markers, '.markers', 'markers');
      needText(
        add,
        at,
        block.markers,
        (marker) => blank(marker.title),
        (i) => [`marker ${i + 1} needs a title.`, `.markers[${i}].title`],
      );
      break;
    case 'video':
    case 'audio':
    case 'embed':
      if (blank(block.title)) add(at, 'needs a title for screen-reader users.', '.title');
      break;
    case 'file':
      if (blank(block.name)) add(at, 'needs a file name.', '.name');
      break;
    case 'accordion':
      atLeast(block.items, 1, 'item', '.items');
      uniqueIds(add, at, block.items, '.items', 'items');
      needText(
        add,
        at,
        block.items,
        (item) => blank(item.title) || blankRich(item.body),
        (i) => [`item ${i + 1} needs a title and text.`, `.items[${i}]`],
      );
      break;
    case 'tabs':
      atLeast(block.tabs, 2, 'tab', '.tabs');
      uniqueIds(add, at, block.tabs, '.tabs', 'tabs');
      needText(
        add,
        at,
        block.tabs,
        (tab) => blank(tab.title) || blankRich(tab.body),
        (i) => [`tab ${i + 1} needs a title and text.`, `.tabs[${i}]`],
      );
      break;
    case 'timeline':
      atLeast(block.items, 2, 'item', '.items');
      uniqueIds(add, at, block.items, '.items', 'items');
      needText(
        add,
        at,
        block.items,
        (item) => blank(item.title),
        (i) => [`item ${i + 1} needs a title.`, `.items[${i}].title`],
      );
      break;
    case 'process':
      atLeast(block.steps, 2, 'step', '.steps');
      uniqueIds(add, at, block.steps, '.steps', 'steps');
      block.steps.forEach((step, i) => {
        if (blank(step.title) || blankRich(step.body))
          add(at, `step ${i + 1} needs a title and text.`, `.steps[${i}]`);
        if (step.image)
          checkImage(add, at, step.image, `.steps[${i}].image`, `picture in step ${i + 1}`);
      });
      break;
    case 'flashcards':
      atLeast(block.cards, 1, 'card', '.cards');
      uniqueIds(add, at, block.cards, '.cards', 'cards');
      block.cards.forEach((card, i) => {
        if (blank(card.front) && !card.frontImage)
          add(at, `card ${i + 1} needs text or a picture on the front.`, `.cards[${i}].front`);
        if (blank(card.back) && !card.backImage)
          add(at, `card ${i + 1} needs text or a picture on the back.`, `.cards[${i}].back`);
        if (card.frontImage)
          checkImage(
            add,
            at,
            card.frontImage,
            `.cards[${i}].frontImage`,
            `front picture on card ${i + 1}`,
          );
        if (card.backImage)
          checkImage(
            add,
            at,
            card.backImage,
            `.cards[${i}].backImage`,
            `back picture on card ${i + 1}`,
          );
      });
      break;
    case 'sorting': {
      atLeast(block.categories, 2, 'category', '.categories');
      atLeast(block.items, 2, 'item', '.items');
      uniqueIds(add, at, block.categories, '.categories', 'categories');
      uniqueIds(add, at, block.items, '.items', 'items');
      needText(
        add,
        at,
        block.categories,
        (category) => blank(category.title),
        (i) => [`category ${i + 1} needs a title.`, `.categories[${i}].title`],
      );
      const categories = new Set(block.categories.map((category) => category.id));
      block.items.forEach((item, i) => {
        if (blank(item.text)) add(at, `item ${i + 1} needs text.`, `.items[${i}].text`);
        if (!categories.has(item.categoryId))
          add(
            at,
            `item ${i + 1} belongs to a category that doesn't exist ("${item.categoryId}").`,
            `.items[${i}].categoryId`,
          );
      });
      break;
    }
    case 'button':
      if (blank(block.label)) add(at, 'needs a label.', '.label');
      break;
    case 'scenario':
      checkScenario(add, at, block);
      break;
  }
}

function checkScenario(add: Add, at: Where, block: ScenarioBlock) {
  if (blank(block.title)) add(at, 'needs a title.', '.title');
  uniqueIds(add, at, block.characters, '.characters', 'characters');
  uniqueIds(add, at, block.scenes, '.scenes', 'scenes');
  const characters = new Set(block.characters.map((character) => character.id));
  block.characters.forEach((character, i) => {
    if (blank(character.name))
      add(at, `character ${i + 1} needs a name.`, `.characters[${i}].name`);
    if (character.avatar)
      checkImage(
        add,
        at,
        character.avatar,
        `.characters[${i}].avatar`,
        `picture of character ${i + 1}`,
      );
  });
  const scenes = new Map(block.scenes.map((scene) => [scene.id, scene]));
  if (!scenes.has(block.startSceneId))
    add(at, `starts at a scene that doesn't exist ("${block.startSceneId}").`, '.startSceneId');
  const next = new Map<Id, Id[]>();
  block.scenes.forEach((scene, i) => {
    const path = `.scenes[${i}]`;
    const name = `scene "${scene.id}"`;
    if (blank(scene.text)) add(at, `${name} needs text.`, `${path}.text`);
    if (scene.speakerId !== undefined && !characters.has(scene.speakerId))
      add(at, `${name} has a speaker who isn't one of the characters.`, `${path}.speakerId`);
    if (scene.choices.length === 0 && !scene.ending)
      add(at, `${name} has no choices, so it needs an ending.`, `${path}.ending`);
    if (scene.ending && blank(scene.ending.title))
      add(at, `${name} needs an ending title.`, `${path}.ending.title`);
    uniqueIds(add, at, scene.choices, `${path}.choices`, `choices in ${name}`);
    const targets: Id[] = [];
    scene.choices.forEach((choice, c) => {
      if (blank(choice.text))
        add(at, `${name}, choice ${c + 1} needs text.`, `${path}.choices[${c}].text`);
      // A retry choice can be picked again and again, so points on it could be farmed.
      if (choice.next.kind === 'retry' && choice.points > 0) {
        add(
          at,
          `${name}, choice ${c + 1}: a choice that sends the learner to try again can't give points.`,
          `${path}.choices[${c}].points`,
        );
      }
      if (choice.next.kind !== 'scene') return;
      if (scenes.has(choice.next.sceneId)) targets.push(choice.next.sceneId);
      else
        add(
          at,
          `${name}, choice ${c + 1} leads to a scene that doesn't exist ("${choice.next.sceneId}").`,
          `${path}.choices[${c}].next`,
        );
    });
    next.set(scene.id, targets);
  });
  // Scene links must not loop ("retry" is the way to start again) and every scene must be able to reach an ending.
  const state = new Map<Id, 'visiting' | 'done'>();
  const visit = (id: Id): Id | undefined => {
    state.set(id, 'visiting');
    for (const target of next.get(id) ?? []) {
      if (state.get(target) === 'visiting') return target;
      if (!state.has(target)) {
        const loop = visit(target);
        if (loop !== undefined) return loop;
      }
    }
    state.set(id, 'done');
    return undefined;
  };
  for (const scene of block.scenes) {
    if (state.has(scene.id)) continue;
    const loop = visit(scene.id);
    if (loop !== undefined) {
      add(
        at,
        `has scenes that lead in a circle back to scene "${loop}"; use "retry" to start again instead.`,
        '.scenes',
      );
      break;
    }
  }
  const reachesEnd = new Set(
    block.scenes.filter((scene) => scene.choices.length === 0).map((scene) => scene.id),
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const [id, targets] of next) {
      if (!reachesEnd.has(id) && targets.some((target) => reachesEnd.has(target))) {
        reachesEnd.add(id);
        grew = true;
      }
    }
  }
  block.scenes.forEach((scene, i) => {
    if (!reachesEnd.has(scene.id))
      add(at, `scene "${scene.id}" can't reach an ending.`, `.scenes[${i}]`);
  });
}

function checkImage(add: Add, where: Where, image: Image, subPath: string, what = 'picture') {
  if (!image.decorative && blank(image.alt))
    add(where, `needs alt text for the ${what}, or mark it as decorative.`, `${subPath}.alt`);
}

function uniqueIds(
  add: Add,
  where: Where,
  items: readonly { id: Id }[],
  subPath: string,
  what: string,
) {
  const seen = new Set<Id>();
  items.forEach((item, i) => {
    if (seen.has(item.id))
      add(where, `has two ${what} with the id "${item.id}".`, `${subPath}[${i}].id`);
    seen.add(item.id);
  });
}

/** Finds every link to a lesson (rich-text links, button targets, scenario choices) and checks the target exists. */
function checkLinks(add: Add, where: Where, value: unknown, course: Course, subPath = '') {
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkLinks(add, where, item, course, `${subPath}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.kind === 'lesson' && typeof record.lessonId === 'string') {
    const target = course.lessons.find((lesson) => lesson.id === record.lessonId);
    if (!target)
      add(where, `links to a lesson that doesn't exist ("${record.lessonId}").`, subPath);
    else if (
      typeof record.blockId === 'string' &&
      !(target.kind === 'content' && target.blocks.some((b) => b.id === record.blockId))
    ) {
      add(where, `links to a block that isn't in that lesson ("${record.blockId}").`, subPath);
    }
  }
  for (const [key, item] of Object.entries(record))
    checkLinks(add, where, item, course, `${subPath}.${key}`);
}
