import type { Image } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { useState } from 'react';
import { useMediaUrl } from '../../media';

export type PictureProps = {
  image: Image;
  className?: string;
  imgClassName?: string;
  /** Shows the caption under the picture (default true). */
  caption?: boolean;
};

/**
 * A course picture with its description (none when it is decorative) and caption. When it can't be loaded it
 * says so, with the description, instead of a broken picture.
 */
export function Picture({ image, className, imgClassName, caption = true }: PictureProps) {
  const src = useMediaUrl(image.media);
  const [failed, setFailed] = useState<string>();
  const alt = image.decorative ? '' : image.alt;
  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      {src && failed !== src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className={cn('w-full rounded', imgClassName)}
        />
      ) : (
        <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded border border-border bg-fill p-4 text-center text-small text-muted">
          <span>This picture couldn't be loaded.</span>
          {alt && <span>It shows: {alt}</span>}
        </div>
      )}
      {caption && image.caption && (
        <figcaption className="text-small text-muted">{image.caption}</figcaption>
      )}
    </figure>
  );
}
