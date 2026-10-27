import type { BlockEditors } from '../registry';
import { ListEditor, QuoteCarouselEditor, TableEditor } from './Collections';
import {
  CalloutEditor,
  CodeEditor,
  ContinueEditor,
  DividerEditor,
  HeadingEditor,
  ParagraphEditor,
  QuoteEditor,
  StatementEditor,
  TwoColumnEditor,
} from './TextBlocks';

/**
 * Editors for heading, paragraph, list, note (callout), statement, quote, quote carousel, two columns, divider,
 * code, table and continue blocks (B8).
 */
export const textEditors: BlockEditors = {
  heading: HeadingEditor,
  paragraph: ParagraphEditor,
  list: ListEditor,
  callout: CalloutEditor,
  statement: StatementEditor,
  quote: QuoteEditor,
  quote_carousel: QuoteCarouselEditor,
  two_column: TwoColumnEditor,
  divider: DividerEditor,
  code: CodeEditor,
  table: TableEditor,
  continue: ContinueEditor,
};
