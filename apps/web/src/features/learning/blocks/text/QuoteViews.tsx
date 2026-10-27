import type { QuoteBlock, QuoteCarouselBlock } from '@carehub/learning';
import { IconButton } from '@carehub/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { BlockViewProps } from '../registry';

function Quote({ text, attribution }: { text: string; attribution?: string | undefined }) {
  return (
    <figure className="space-y-2 border-l-4 border-border pl-4">
      <blockquote className="whitespace-pre-line text-h3 text-fg">{text}</blockquote>
      {attribution && <figcaption className="text-small text-muted">{attribution}</figcaption>}
    </figure>
  );
}

/** A quote with who said it. (A quote on a picture shows as a plain quote for now.) */
export function QuoteView({ block }: BlockViewProps<QuoteBlock>) {
  return <Quote text={block.text} attribution={block.attribution} />;
}

/** Quotes one at a time, with Previous and Next. */
export function QuoteCarouselView({ block }: BlockViewProps<QuoteCarouselBlock>) {
  const [index, setIndex] = useState(0);
  const count = block.quotes.length;
  const shown = Math.min(index, count - 1);
  const quote = block.quotes[shown];
  if (!quote) return <></>;
  const step = (by: number) => setIndex((shown + by + count) % count);
  return (
    <div role="group" aria-label="Quotes" className="space-y-4">
      <div aria-live="polite">
        <Quote text={quote.text} attribution={quote.attribution} />
      </div>
      {count > 1 && (
        <div className="flex items-center justify-center gap-2">
          <IconButton label="Previous quote" onClick={() => step(-1)} className="max-md:size-11">
            <ChevronLeft aria-hidden />
          </IconButton>
          <p className="text-small text-muted">{`${shown + 1} of ${count}`}</p>
          <IconButton label="Next quote" onClick={() => step(1)} className="max-md:size-11">
            <ChevronRight aria-hidden />
          </IconButton>
        </div>
      )}
    </div>
  );
}
