import type { Block, Image, Question, RichText } from '../format/index';
import type { HelpSelection } from './api';

// What Claude reads for Learning help (decision 0315): course content only, meaning titles and the text
// authors wrote in lessons and blocks. Studio and the server share these functions, so a selection's offsets
// point at the same text on both sides.

/** Rich text as Studio's text field shows it: paragraphs separated by a blank line, formatting left out. */
export function helpRichText(value: RichText | undefined): string {
  return (value ?? [])
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n\n');
}

const image = (value: Image | undefined): string[] =>
  value ? [value.caption ?? '', value.decorative ? '' : value.alt] : [];

function questionParts(question: Question): string[] {
  const prompt = helpRichText(question.prompt);
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      return [prompt, ...question.options.map((option) => option.text)];
    case 'matching':
    case 'drag_matching':
      return [prompt, ...question.pairs.map((pair) => `${pair.prompt}: ${pair.match}`)];
    case 'fill_blank':
      return [
        prompt,
        question.parts.map((part) => (part.kind === 'text' ? part.text : '___')).join(''),
      ];
    case 'ordering':
      return [prompt, ...question.items.map((item) => item.text)];
    case 'true_false':
    case 'hotspot':
      return [prompt];
  }
}

function blockParts(block: Block): string[] {
  switch (block.type) {
    case 'heading':
    case 'statement':
      return [block.text];
    case 'paragraph':
      return [helpRichText(block.text)];
    case 'list':
      return block.items.map((item) => helpRichText(item.text));
    case 'callout':
      return [block.title ?? '', helpRichText(block.text)];
    case 'quote':
      return [block.text, block.attribution ?? ''];
    case 'quote_carousel':
      return block.quotes.flatMap((quote) => [quote.text, quote.attribution ?? '']);
    case 'two_column':
      return [helpRichText(block.left), helpRichText(block.right)];
    case 'table':
      return block.rows.map((row) => row.join(' | '));
    case 'image':
      return [...image(block.image), helpRichText(block.text)];
    case 'gallery':
      return block.images.flatMap(image);
    case 'labeled_graphic':
      return [
        ...image(block.image),
        ...block.markers.flatMap((marker) => [marker.title, helpRichText(marker.text)]),
      ];
    case 'video':
    case 'audio':
      return [block.title, helpRichText(block.transcript)];
    case 'file':
      return [block.name, block.description ?? ''];
    case 'embed':
      return [block.title];
    case 'accordion':
      return block.items.flatMap((item) => [item.title, helpRichText(item.body)]);
    case 'tabs':
      return block.tabs.flatMap((tab) => [tab.title, helpRichText(tab.body)]);
    case 'timeline':
      return block.items.flatMap((item) => [item.label, item.title, helpRichText(item.body)]);
    case 'process':
      return [
        block.intro?.title ?? '',
        helpRichText(block.intro?.body),
        ...block.steps.flatMap((step) => [step.title, helpRichText(step.body)]),
        block.summary?.title ?? '',
        helpRichText(block.summary?.body),
      ];
    case 'flashcards':
      return block.cards.flatMap((card) => [card.front, card.back]);
    case 'sorting':
      return [...block.categories.map((c) => c.title), ...block.items.map((item) => item.text)];
    case 'button':
      return [block.label, block.description ?? ''];
    case 'knowledge_check':
      return questionParts(block.question);
    case 'scenario':
      return [
        block.title,
        helpRichText(block.intro),
        ...block.scenes.flatMap((scene) => [scene.text, ...scene.choices.map((c) => c.text)]),
      ];
    case 'divider':
    case 'code':
    case 'continue':
      return [];
  }
}

const joined = (parts: string[]) => parts.filter((part) => part.trim() !== '').join('\n\n');

/** A block's text for Claude, each part separated by a blank line. Selections are offsets into it. */
export function blockHelpText(block: Block): string {
  return joined(blockParts(block));
}

/** The selected part of a block's text, or null when the offsets fall outside it. */
export function cutHelpSelection(text: string, selection: HelpSelection): string | null {
  const { start, end } = selection;
  return start < end && end <= text.length ? text.slice(start, end) : null;
}
