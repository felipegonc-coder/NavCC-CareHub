import { z } from 'zod';
import {
  ExternalIdSchema,
  HttpsUrlSchema,
  IdSchema,
  ImageSchema,
  LIMITS,
  LinkUrlSchema,
  MediaRefSchema,
  RichTextSchema,
} from './primitives';
import { QuestionSchema } from './questions';
import { percent, text } from './zod-helpers';

const block = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ id: IdSchema, type: z.literal(type), ...shape });

const titled = { id: IdSchema, title: text(LIMITS.title) };

// ---------- Text ----------
export const HeadingBlockSchema = block('heading', {
  level: z.literal([1, 2, 3]),
  text: text(LIMITS.title),
});
export const ParagraphBlockSchema = block('paragraph', { text: RichTextSchema });
export const ListBlockSchema = block('list', {
  style: z.enum(['bulleted', 'numbered', 'checkbox']),
  items: z.array(z.strictObject({ id: IdSchema, text: RichTextSchema })).max(LIMITS.listItems),
});
export const CalloutBlockSchema = block('callout', {
  tone: z.enum(['note', 'tip', 'warning', 'success']),
  title: text(LIMITS.title).optional(),
  text: RichTextSchema,
});
export const StatementBlockSchema = block('statement', { text: text(LIMITS.statement) });
export const QuoteBlockSchema = block('quote', {
  text: text(LIMITS.longText),
  attribution: text(LIMITS.title).optional(),
  background: ImageSchema.optional(),
});
export const QuoteCarouselBlockSchema = block('quote_carousel', {
  quotes: z
    .array(
      z.strictObject({
        id: IdSchema,
        text: text(LIMITS.longText),
        attribution: text(LIMITS.title).optional(),
      }),
    )
    .max(LIMITS.quotes),
});
export const TwoColumnBlockSchema = block('two_column', {
  left: RichTextSchema,
  right: RichTextSchema,
});
export const DividerBlockSchema = block('divider', {
  style: z.enum(['line', 'numbered', 'spacer']),
});
export const CodeBlockSchema = block('code', {
  language: text(LIMITS.label).optional(),
  code: text(LIMITS.code),
});
export const TableBlockSchema = block('table', {
  headerRow: z.boolean(),
  rows: z.array(z.array(text(LIMITS.tableCell)).max(LIMITS.tableColumns)).max(LIMITS.tableRows),
});

// ---------- Media ----------
export const ImageBlockSchema = block('image', {
  image: ImageSchema,
  size: z.enum(['small', 'medium', 'full']),
  layout: z.enum(['standard', 'image_and_text', 'text_on_image', 'banner']).optional(),
  text: RichTextSchema.optional(),
});
export const GalleryBlockSchema = block('gallery', {
  layout: z.enum(['carousel', 'grid']),
  images: z.array(ImageSchema).max(LIMITS.galleryImages),
});
export const LabeledGraphicBlockSchema = block('labeled_graphic', {
  image: ImageSchema,
  markers: z
    .array(
      z.strictObject({
        id: IdSchema,
        x: percent(),
        y: percent(),
        title: text(LIMITS.title),
        text: RichTextSchema,
      }),
    )
    .max(LIMITS.markers),
});
export const VideoBlockSchema = block('video', {
  media: MediaRefSchema,
  title: text(LIMITS.title),
  captions: z
    .array(
      z.strictObject({
        fileId: ExternalIdSchema,
        language: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, {
          error: 'Use a language tag such as "en" or "es-MX".',
        }),
        label: text(LIMITS.label).optional(),
      }),
    )
    .max(LIMITS.captions)
    .optional(),
  transcript: RichTextSchema.optional(),
});
export const AudioBlockSchema = block('audio', {
  media: MediaRefSchema,
  title: text(LIMITS.title),
  transcript: RichTextSchema.optional(),
});
export const FileBlockSchema = block('file', {
  fileId: ExternalIdSchema,
  name: text(LIMITS.title),
  description: text(LIMITS.shortText).optional(),
});
export const EmbedBlockSchema = block('embed', {
  url: HttpsUrlSchema,
  title: text(LIMITS.title),
  height: z.number().int().min(LIMITS.embedHeight.min).max(LIMITS.embedHeight.max).optional(),
});

// ---------- Interactive ----------
export const AccordionBlockSchema = block('accordion', {
  items: z.array(z.strictObject({ ...titled, body: RichTextSchema })).max(LIMITS.accordionItems),
});
export const TabsBlockSchema = block('tabs', {
  tabs: z.array(z.strictObject({ ...titled, body: RichTextSchema })).max(LIMITS.tabs),
});
export const TimelineBlockSchema = block('timeline', {
  items: z
    .array(
      z.strictObject({
        id: IdSchema,
        label: text(LIMITS.title),
        title: text(LIMITS.title),
        body: RichTextSchema.optional(),
      }),
    )
    .max(LIMITS.timelineItems),
});
const processPanel = z.strictObject({ title: text(LIMITS.title), body: RichTextSchema.optional() });
export const ProcessBlockSchema = block('process', {
  intro: processPanel.optional(),
  steps: z
    .array(z.strictObject({ ...titled, body: RichTextSchema, image: ImageSchema.optional() }))
    .max(LIMITS.processSteps),
  summary: processPanel.optional(),
});
export const FlashcardsBlockSchema = block('flashcards', {
  cards: z
    .array(
      z.strictObject({
        id: IdSchema,
        front: text(LIMITS.shortText),
        back: text(LIMITS.longText),
        frontImage: ImageSchema.optional(),
        backImage: ImageSchema.optional(),
      }),
    )
    .max(LIMITS.flashcards),
});
export const SortingBlockSchema = block('sorting', {
  categories: z.array(z.strictObject(titled)).max(LIMITS.sortingCategories),
  items: z
    .array(z.strictObject({ id: IdSchema, text: text(LIMITS.shortText), categoryId: IdSchema }))
    .max(LIMITS.sortingItems),
});
export const ButtonTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('url'), url: LinkUrlSchema }),
  z.strictObject({ kind: z.literal('page'), pageId: ExternalIdSchema }),
  z.strictObject({ kind: z.literal('file'), fileId: ExternalIdSchema }),
  z.strictObject({ kind: z.literal('lesson'), lessonId: IdSchema, blockId: IdSchema.optional() }),
]);
export const ButtonBlockSchema = block('button', {
  label: text(LIMITS.buttonLabel),
  description: text(LIMITS.shortText).optional(),
  target: ButtonTargetSchema,
});
export const ContinueBlockSchema = block('continue', {
  label: text(LIMITS.label).optional(),
  requires: z.enum(['click', 'complete_above']),
});
export const KnowledgeCheckBlockSchema = block('knowledge_check', {
  question: QuestionSchema,
  allowRetry: z.boolean(),
});

export const ScenarioChoiceSchema = z.strictObject({
  id: IdSchema,
  text: text(LIMITS.shortText),
  points: z.number().int().min(-LIMITS.choicePoints).max(LIMITS.choicePoints),
  coaching: RichTextSchema.optional(),
  next: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('scene'), sceneId: IdSchema }),
    z.strictObject({ kind: z.literal('retry') }),
    z.strictObject({ kind: z.literal('lesson'), lessonId: IdSchema }),
  ]),
});
export const ScenarioSceneSchema = z.strictObject({
  id: IdSchema,
  speakerId: IdSchema.optional(),
  text: text(LIMITS.sceneText),
  choices: z.array(ScenarioChoiceSchema).max(LIMITS.scenarioChoices),
  ending: z
    .strictObject({
      outcome: z.enum(['great', 'okay', 'poor']),
      title: text(LIMITS.title),
      text: RichTextSchema.optional(),
    })
    .optional(),
});
export const ScenarioBlockSchema = block('scenario', {
  title: text(LIMITS.title),
  intro: RichTextSchema.optional(),
  characters: z
    .array(
      z.strictObject({
        id: IdSchema,
        name: text(LIMITS.title),
        role: text(LIMITS.title).optional(),
        avatar: ImageSchema.optional(),
      }),
    )
    .max(LIMITS.scenarioCharacters),
  startSceneId: IdSchema,
  scenes: z.array(ScenarioSceneSchema).max(LIMITS.scenarioScenes),
  passScore: z
    .number()
    .int()
    .min(-LIMITS.scenarioPassScore)
    .max(LIMITS.scenarioPassScore)
    .optional(),
});

export const BlockSchema = z.discriminatedUnion('type', [
  HeadingBlockSchema,
  ParagraphBlockSchema,
  ListBlockSchema,
  CalloutBlockSchema,
  StatementBlockSchema,
  QuoteBlockSchema,
  QuoteCarouselBlockSchema,
  TwoColumnBlockSchema,
  DividerBlockSchema,
  CodeBlockSchema,
  TableBlockSchema,
  ImageBlockSchema,
  GalleryBlockSchema,
  LabeledGraphicBlockSchema,
  VideoBlockSchema,
  AudioBlockSchema,
  FileBlockSchema,
  EmbedBlockSchema,
  AccordionBlockSchema,
  TabsBlockSchema,
  TimelineBlockSchema,
  ProcessBlockSchema,
  FlashcardsBlockSchema,
  SortingBlockSchema,
  ButtonBlockSchema,
  ContinueBlockSchema,
  KnowledgeCheckBlockSchema,
  ScenarioBlockSchema,
]);

/** The 28 block types, in the order of the format doc. */
export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list',
  'callout',
  'statement',
  'quote',
  'quote_carousel',
  'two_column',
  'divider',
  'code',
  'table',
  'image',
  'gallery',
  'labeled_graphic',
  'video',
  'audio',
  'file',
  'embed',
  'accordion',
  'tabs',
  'timeline',
  'process',
  'flashcards',
  'sorting',
  'button',
  'continue',
  'knowledge_check',
  'scenario',
] as const satisfies readonly z.infer<typeof BlockSchema>['type'][];

export type HeadingBlock = z.infer<typeof HeadingBlockSchema>;
export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>;
export type ListBlock = z.infer<typeof ListBlockSchema>;
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>;
export type StatementBlock = z.infer<typeof StatementBlockSchema>;
export type QuoteBlock = z.infer<typeof QuoteBlockSchema>;
export type QuoteCarouselBlock = z.infer<typeof QuoteCarouselBlockSchema>;
export type TwoColumnBlock = z.infer<typeof TwoColumnBlockSchema>;
export type DividerBlock = z.infer<typeof DividerBlockSchema>;
export type CodeBlock = z.infer<typeof CodeBlockSchema>;
export type TableBlock = z.infer<typeof TableBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type GalleryBlock = z.infer<typeof GalleryBlockSchema>;
export type LabeledGraphicBlock = z.infer<typeof LabeledGraphicBlockSchema>;
export type VideoBlock = z.infer<typeof VideoBlockSchema>;
export type AudioBlock = z.infer<typeof AudioBlockSchema>;
export type FileBlock = z.infer<typeof FileBlockSchema>;
export type EmbedBlock = z.infer<typeof EmbedBlockSchema>;
export type AccordionBlock = z.infer<typeof AccordionBlockSchema>;
export type TabsBlock = z.infer<typeof TabsBlockSchema>;
export type TimelineBlock = z.infer<typeof TimelineBlockSchema>;
export type ProcessBlock = z.infer<typeof ProcessBlockSchema>;
export type FlashcardsBlock = z.infer<typeof FlashcardsBlockSchema>;
export type SortingBlock = z.infer<typeof SortingBlockSchema>;
export type ButtonTarget = z.infer<typeof ButtonTargetSchema>;
export type ButtonBlock = z.infer<typeof ButtonBlockSchema>;
export type ContinueBlock = z.infer<typeof ContinueBlockSchema>;
export type KnowledgeCheckBlock = z.infer<typeof KnowledgeCheckBlockSchema>;
export type ScenarioChoice = z.infer<typeof ScenarioChoiceSchema>;
export type ScenarioScene = z.infer<typeof ScenarioSceneSchema>;
export type ScenarioBlock = z.infer<typeof ScenarioBlockSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type BlockType = Block['type'];
