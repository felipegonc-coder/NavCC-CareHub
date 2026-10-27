import type { ImageBlock } from '@carehub/learning';
import { ImageField } from '../../../media';
import { ChoiceGroup } from './ChoiceGroup';
import type { EditorProps } from './editor-props';
import { optionalRichText, RichTextField, withOptional } from './fields';

type Layout = NonNullable<ImageBlock['layout']>;

const LAYOUTS: readonly { value: Layout; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'image_and_text', label: 'Picture beside text' },
  { value: 'text_on_image', label: 'Text on the picture' },
  { value: 'banner', label: 'Banner' },
];

const SIZES: readonly { value: ImageBlock['size']; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'full', label: 'Full width' },
];

/** A picture block: the picture, its layout, its size (standard layout) and its text (all but banners). */
export function ImageEditor({ block, onChange, course }: EditorProps<ImageBlock>) {
  const layout = block.layout ?? 'standard';
  return (
    <div className="flex flex-col gap-5">
      <ImageField
        required
        value={block.image}
        courseId={course.id}
        onChange={(image) => image && onChange({ ...block, image })}
      />
      <ChoiceGroup
        legend="Layout"
        value={layout}
        options={LAYOUTS}
        onChange={(next) => onChange({ ...block, layout: next })}
      />
      {layout === 'standard' && (
        <ChoiceGroup
          legend="Size"
          value={block.size}
          options={SIZES}
          onChange={(size) => onChange({ ...block, size })}
        />
      )}
      {layout !== 'banner' && (
        <RichTextField
          label="Text"
          hint={layout === 'standard' ? 'Optional. Shown under the picture.' : undefined}
          value={block.text}
          course={course}
          onChange={(text) => onChange(withOptional(block, 'text', optionalRichText(text)))}
        />
      )}
    </div>
  );
}
