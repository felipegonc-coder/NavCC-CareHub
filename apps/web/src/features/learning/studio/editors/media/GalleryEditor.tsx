import { LIMITS, type GalleryBlock, type Image } from '@carehub/learning';
import { ImageField, MediaPicker } from '../../../media';
import { ChoiceButtons } from '../../fields';
import type { BlockEditorProps } from '../registry';
import { ListControls, moveTo } from './ListControls';

const LAYOUTS: readonly { value: GalleryBlock['layout']; label: string }[] = [
  { value: 'carousel', label: 'Carousel, one at a time' },
  { value: 'grid', label: 'Grid' },
];

const PICTURES = ['image'] as const;

/** Keys that follow each picture when the list is reordered (pictures have no ids). */
function pictureKeys(images: readonly Image[]): string[] {
  const seen = new Map<string, number>();
  return images.map(({ media }) => {
    const key = media.kind === 'file' ? media.fileId : media.url;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return `${key}#${count}`;
  });
}

/** A gallery block: its layout, and its pictures to add, edit, reorder and remove. */
export function GalleryEditor({ block, onChange, course }: BlockEditorProps<GalleryBlock>) {
  const { images } = block;
  const keys = pictureKeys(images);
  const setImages = (next: Image[]) => onChange({ ...block, images: next });
  return (
    <div className="flex flex-col gap-5">
      <ChoiceButtons
        label="Layout"
        value={block.layout}
        options={LAYOUTS}
        onChange={(layout) => onChange({ ...block, layout })}
      />
      {images.length > 0 && (
        <ol className="flex flex-col gap-3">
          {images.map((image, index) => (
            <li
              key={keys[index]}
              className="flex items-start gap-2 rounded border border-border p-3"
            >
              <ImageField
                required
                className="grow"
                label={`Picture ${index + 1}`}
                value={image}
                courseId={course.id}
                onChange={(next) =>
                  next && setImages(images.map((item, at) => (at === index ? next : item)))
                }
              />
              <ListControls
                name={`picture ${index + 1}`}
                index={index}
                count={images.length}
                onMove={(to) => setImages(moveTo(images, index, to))}
                onRemove={() => setImages(images.filter((_, at) => at !== index))}
              />
            </li>
          ))}
        </ol>
      )}
      {images.length < LIMITS.galleryImages ? (
        <MediaPicker
          accept={PICTURES}
          allowLink
          courseId={course.id}
          label="Add a picture"
          onPick={(picked) => setImages([...images, { media: picked.media, alt: '' }])}
        />
      ) : (
        <p className="text-small text-muted">
          This gallery is full ({LIMITS.galleryImages} pictures at most).
        </p>
      )}
    </div>
  );
}
