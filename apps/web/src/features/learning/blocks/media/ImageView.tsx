import type { ImageBlock } from '@carehub/learning';
import { cn } from '@carehub/ui';
import type { BlockViewProps } from '../registry';
import { RichTextView } from '../text/RichTextView';
import { Picture } from './Picture';

/** Share of the lesson column: small is a third (half on phones), medium two thirds (all on phones). */
const SIZES: Readonly<Record<ImageBlock['size'], string>> = {
  small: 'w-1/2 md:w-1/3',
  medium: 'md:w-2/3',
  full: '',
};

/**
 * A picture block. Layouts: standard (at its size), picture and text side by side (stacked on phones), text on
 * the picture (in a panel that keeps it readable; under the picture on phones) and banner (full width, cropped).
 */
export function ImageView({ block, course, go }: BlockViewProps<ImageBlock>) {
  const text = <RichTextView value={block.text} course={course} go={go} />;
  switch (block.layout ?? 'standard') {
    case 'image_and_text':
      return (
        <div className="grid items-center gap-6 md:grid-cols-2">
          <Picture image={block.image} />
          <div>{text}</div>
        </div>
      );
    case 'text_on_image':
      return (
        <div className="relative flex flex-col gap-3">
          <Picture image={block.image} imgClassName="max-h-96 object-cover" />
          {block.text && (
            <div className="rounded border border-border bg-bg/90 p-4 text-fg md:absolute md:inset-x-6 md:top-6">
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
