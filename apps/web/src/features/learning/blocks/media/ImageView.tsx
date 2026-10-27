import type { ImageBlock } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { Picture } from './Picture';
import { RichTextView } from './RichTextView';
import type { ViewProps } from './view-props';

const SIZES: Readonly<Record<ImageBlock['size'], string>> = {
  small: 'max-w-xs',
  medium: 'max-w-lg',
  full: 'max-w-none',
};

/**
 * A picture block. Layouts: standard (at its size), picture and text side by side (stacked on phones), text on
 * the picture (in a panel that keeps it readable; under the picture on phones) and banner (full width, cropped).
 */
export function ImageView({ block, course, go }: ViewProps<ImageBlock>) {
  const text = <RichTextView value={block.text} course={course} go={go} />;
  switch (block.layout ?? 'standard') {
    case 'image_and_text':
      return (
        <div className="grid items-center gap-6 sm:grid-cols-2">
          <Picture image={block.image} />
          <div>{text}</div>
        </div>
      );
    case 'text_on_image':
      return (
        <div className="relative flex flex-col gap-3">
          <Picture image={block.image} imgClassName="max-h-96 object-cover" />
          {block.text && (
            <div className="rounded border border-border bg-bg/90 p-4 text-fg sm:absolute sm:inset-x-6 sm:top-6">
              {text}
            </div>
          )}
        </div>
      );
    case 'banner':
      return <Picture image={block.image} imgClassName="max-h-64 object-cover" />;
    default:
      return (
        <div className="flex flex-col gap-4">
          <Picture image={block.image} className={cn('mx-auto w-full', SIZES[block.size])} />
          {text}
        </div>
      );
  }
}
