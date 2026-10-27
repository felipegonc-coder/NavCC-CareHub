import type { GalleryBlock } from '@carehub/learning';
import { IconButton } from '@carehub/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { BlockViewProps } from '../registry';
import { Picture } from './Picture';

/**
 * A gallery: a grid of pictures, or a carousel showing one at a time with Previous and Next buttons (it wraps
 * around) and "Picture 2 of 5" read out when it changes.
 */
export function GalleryView({ block }: BlockViewProps<GalleryBlock>) {
  const [index, setIndex] = useState(0);
  const { images } = block;
  if (images.length === 0)
    return <p className="text-small text-muted">This gallery has no pictures yet.</p>;
  if (block.layout === 'grid')
    return (
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {images.map((image, i) => (
          <li key={i}>
            <Picture image={image} imgClassName="aspect-square object-cover" />
          </li>
        ))}
      </ul>
    );
  const at = Math.min(index, images.length - 1);
  const show = (to: number) => setIndex((to + images.length) % images.length);
  const image = images[at];
  return (
    <section aria-roledescription="carousel" aria-label="Pictures" className="flex flex-col gap-3">
      {image && (
        <div role="group" aria-roledescription="slide" aria-label={`${at + 1} of ${images.length}`}>
          <Picture image={image} imgClassName="max-h-96 object-contain" />
        </div>
      )}
      {images.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <IconButton label="Previous picture" variant="secondary" onClick={() => show(at - 1)}>
            <ChevronLeft aria-hidden />
          </IconButton>
          <p aria-live="polite" className="text-small text-muted">
            Picture {at + 1} of {images.length}
          </p>
          <IconButton label="Next picture" variant="secondary" onClick={() => show(at + 1)}>
            <ChevronRight aria-hidden />
          </IconButton>
        </div>
      )}
    </section>
  );
}
