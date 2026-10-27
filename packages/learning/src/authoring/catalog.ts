import type { Block, BlockType, QuestionType } from '../format/index';
import { blockNeed, newBlock, newKnowledgeCheck } from './factories';
import type { BlockNeed, BlockSeed } from './factories';
import type { IdGen } from './types';

/** Add-block menu groups, in display order. */
export const BLOCK_GROUPS = ['Text', 'Media', 'Interactive', 'Questions'] as const;
export type BlockGroup = (typeof BLOCK_GROUPS)[number];

/** Lucide icon names for the menu; the web app maps each name to its icon component. */
// prettier-ignore
export type BlockIconName =
  | 'Heading' | 'Pilcrow' | 'List' | 'Info' | 'Megaphone' | 'Quote' | 'MessageSquareQuote' | 'Columns2'
  | 'SeparatorHorizontal' | 'Code' | 'Table' | 'Image' | 'Images' | 'MapPin' | 'Video' | 'Headphones'
  | 'FileDown' | 'Globe' | 'ListCollapse' | 'PanelTop' | 'Milestone' | 'Footprints' | 'Layers' | 'Shapes'
  | 'MessagesSquare' | 'MousePointerClick' | 'ChevronsDown' | 'CircleDot' | 'ListChecks' | 'ToggleLeft'
  | 'ArrowLeftRight' | 'Move' | 'TextCursorInput' | 'ListOrdered' | 'Crosshair';

/** One choice in the add-block menu. Knowledge checks have one entry per question type. */
export type BlockCatalogEntry = {
  /** Unique: the block type, or "knowledge_check:<question type>". */
  key: string;
  type: BlockType;
  questionType?: QuestionType;
  label: string;
  group: BlockGroup;
  icon: BlockIconName;
  description: string;
  keywords: string[];
  /** What the menu must ask for (a picture, media, file or address) before adding the block. */
  need: BlockNeed | null;
};

/** One question type for a quiz's "Add question" menu and the knowledge-check type picker. */
export type QuestionCatalogEntry = {
  type: QuestionType;
  label: string;
  icon: BlockIconName;
  description: string;
  keywords: string[];
};

type Row<T> = [type: T, label: string, icon: BlockIconName, description: string, keywords: string];

// prettier-ignore
const QUESTION_ROWS: Row<QuestionType>[] = [
  ['single_choice', 'Single answer', 'CircleDot', 'Pick the one right answer.', 'multiple choice,radio'],
  ['multiple_choice', 'Multiple answer', 'ListChecks', 'Pick all the right answers.', 'checkboxes,select all'],
  ['true_false', 'True or false', 'ToggleLeft', 'Say whether a statement is true.', 'yes no'],
  ['matching', 'Matching', 'ArrowLeftRight', 'Match each item with one from a list.', 'pairs'],
  ['drag_matching', 'Drag-and-drop matching', 'Move', 'Match items by dragging them.', 'pairs,drag'],
  ['fill_blank', 'Fill in the blank', 'TextCursorInput', 'Type the missing word.', 'type,gap'],
  ['ordering', 'Put in order', 'ListOrdered', 'Put steps in the right order.', 'sequence,sort,order'],
  ['hotspot', 'Click the right spot', 'Crosshair', 'Click the right place on a picture.', 'hotspot,screenshot'],
];

// prettier-ignore
const BLOCK_ROWS: [BlockGroup, Row<Exclude<BlockType, 'knowledge_check'>>[]][] = [
  ['Text', [
    ['heading', 'Heading', 'Heading', 'A title for a section.', 'title,subheading'],
    ['paragraph', 'Paragraph', 'Pilcrow', 'Text with formatting and links.', 'text,body'],
    ['list', 'List', 'List', 'Bulleted, numbered or checkbox list.', 'bullets,numbers,checklist'],
    ['callout', 'Note', 'Info', 'A coloured box for a tip, warning or note.', 'callout,tip,warning'],
    ['statement', 'Statement', 'Megaphone', 'One big line that makes a key point stand out.', 'key point,big text'],
    ['quote', 'Quote', 'Quote', "A quote with the speaker's name.", 'testimonial,saying'],
    ['quote_carousel', 'Quote carousel', 'MessageSquareQuote', 'Several quotes to swipe through.', 'quotes,slides'],
    ['two_column', 'Two columns', 'Columns2', 'Two pieces of text side by side.', 'columns,side by side'],
    ['divider', 'Divider', 'SeparatorHorizontal', 'A line, number or space between sections.', 'line,spacer,separator'],
    ['code', 'Code', 'Code', 'A code snippet, shown but never run.', 'snippet'],
    ['table', 'Table', 'Table', 'A simple grid of rows and columns.', 'grid,rows,columns'],
  ]],
  ['Media', [
    ['image', 'Image', 'Image', 'A picture with a caption and a description.', 'picture,photo,screenshot'],
    ['gallery', 'Gallery', 'Images', 'Several pictures in a carousel or grid.', 'pictures,carousel,grid'],
    ['labeled_graphic', 'Labeled graphic', 'MapPin', 'Numbered spots on a picture that open notes.', 'markers,hotspots,picture'],
    ['video', 'Video', 'Video', 'A video from a file or a link.', 'movie,clip,youtube'],
    ['audio', 'Audio', 'Headphones', 'An audio clip, such as a sample call.', 'sound,recording,call'],
    ['file', 'File download', 'FileDown', 'A file people can download.', 'attachment,pdf,download'],
    ['embed', 'Web embed', 'Globe', 'Another web page shown inside the lesson.', 'web page,website,link'],
  ]],
  ['Interactive', [
    ['accordion', 'Accordion', 'ListCollapse', 'Sections that open when clicked.', 'collapse,expand,sections'],
    ['tabs', 'Tabs', 'PanelTop', 'Content split into tabs.', 'tab,sections'],
    ['timeline', 'Timeline', 'Milestone', 'Events or steps along a line.', 'dates,history,events'],
    ['process', 'Process', 'Footprints', 'Walk through a task one step at a time.', 'steps,step by step,how to'],
    ['flashcards', 'Flashcards', 'Layers', 'Cards that flip to show the answer.', 'cards,flip,terms'],
    ['sorting', 'Sorting activity', 'Shapes', 'Drag cards into the right group.', 'categories,groups,drag'],
    ['scenario', 'Scenario', 'MessagesSquare', 'A branching practice conversation.', 'role-play,conversation,branching'],
    ['button', 'Button', 'MousePointerClick', 'Opens a link, page or file, or jumps to a lesson.', 'link,jump'],
    ['continue', 'Continue', 'ChevronsDown', 'Hides the rest until people continue.', 'gate,next,stop'],
  ]],
];

/** The 8 question types, for a quiz's "Add question" menu and the knowledge-check type picker. */
export const questionCatalog: readonly QuestionCatalogEntry[] = QUESTION_ROWS.map(
  ([type, label, icon, description, words]) => ({
    type,
    label,
    icon,
    description,
    keywords: words.split(','),
  }),
);

/** Every block for the add-block menu: 27 block types, then a knowledge check for each question type. */
export const blockCatalog: readonly BlockCatalogEntry[] = [
  ...BLOCK_ROWS.flatMap(([group, rows]) =>
    rows.map(([type, label, icon, description, words]): BlockCatalogEntry => {
      return {
        key: type,
        type,
        label,
        group,
        icon,
        description,
        keywords: words.split(','),
        need: blockNeed(type),
      };
    }),
  ),
  ...questionCatalog.map(({ type, label, icon, description, keywords }): BlockCatalogEntry => ({
    key: `knowledge_check:${type}`,
    type: 'knowledge_check',
    questionType: type,
    label,
    group: 'Questions',
    icon,
    description: `Knowledge check: ${description.charAt(0).toLowerCase()}${description.slice(1)}`,
    keywords: ['knowledge check', 'question', 'quiz', ...keywords],
    need: blockNeed('knowledge_check', type),
  })),
];

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Entries whose label, description, group or keywords contain every word of `query` (accent- and case-insensitive). */
export function searchBlockCatalog(
  query: string,
  catalog: readonly BlockCatalogEntry[] = blockCatalog,
): BlockCatalogEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return catalog.filter((entry) => {
    const haystack = fold(
      [entry.label, entry.description, entry.group, ...entry.keywords].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

/** A new block for a menu entry; pass what was picked when the entry has a `need`. */
export function newBlockFromCatalog(
  entry: BlockCatalogEntry,
  newId?: IdGen,
  seed?: BlockSeed,
): Block {
  return entry.questionType
    ? newKnowledgeCheck(entry.questionType, newId, seed)
    : newBlock(entry.type, newId, seed);
}
