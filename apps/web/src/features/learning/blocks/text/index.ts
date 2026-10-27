import type { BlockViews } from '../registry';
import { CalloutView } from './CalloutView';
import { ContinueView } from './ContinueView';
import { ListView } from './ListView';
import { QuoteCarouselView, QuoteView } from './QuoteViews';
import {
  CodeView,
  DividerView,
  HeadingView,
  ParagraphView,
  StatementView,
  TableView,
  TwoColumnView,
} from './TextViews';

// Text and continue blocks (B5). RichTextView is the one read-only rich-text view (decision 0306).
export { RichTextView, type RichTextViewProps } from './RichTextView';

/** The text family's views; blocks/registry.tsx spreads them into `blockViews`. */
export const textViews: BlockViews = {
  heading: HeadingView,
  paragraph: ParagraphView,
  list: ListView,
  callout: CalloutView,
  statement: StatementView,
  quote: QuoteView,
  quote_carousel: QuoteCarouselView,
  two_column: TwoColumnView,
  divider: DividerView,
  code: CodeView,
  table: TableView,
  continue: ContinueView,
};
