import { LIMITS, newId, type LabeledGraphicBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { ImageField } from '../../../media';
import type { EditorProps } from './editor-props';
import { RichTextField } from './fields';
import { AddButton, ListControls, moveTo } from './ListControls';

type Marker = LabeledGraphicBlock['markers'][number];

const SIDES = [
  ['x', 'From the left (%)'],
  ['y', 'From the top (%)'],
] as const;

/** A number typed into a percent box, kept within 0–100 (empty counts as 0). */
const toPercent = (input: string) => {
  const value = Number(input);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
};

/** A labelled picture block: the picture, and spots on it with a title and a note each. */
export function LabeledGraphicEditor({
  block,
  onChange,
  course,
}: EditorProps<LabeledGraphicBlock>) {
  const { markers } = block;
  const setMarkers = (next: Marker[]) => onChange({ ...block, markers: next });
  const update = (id: string, patch: Partial<Marker>) =>
    setMarkers(markers.map((marker) => (marker.id === id ? { ...marker, ...patch } : marker)));
  return (
    <div className="flex flex-col gap-5">
      <ImageField
        required
        caption={false}
        value={block.image}
        courseId={course.id}
        onChange={(image) => image && onChange({ ...block, image })}
      />
      <p className="text-small text-muted">
        Spots are placed in % of the picture, from its top-left corner.
      </p>
      {markers.length > 0 && (
        <ol className="flex flex-col gap-3">
          {markers.map((marker, index) => (
            <li key={marker.id}>
              <fieldset className="flex flex-col gap-3 rounded border border-border p-3">
                <legend className="text-small font-medium text-fg">Spot {index + 1}</legend>
                <div className="flex items-end gap-2">
                  <Field label="Title" className="grow">
                    <Input
                      value={marker.title}
                      maxLength={LIMITS.title}
                      onChange={(event) => update(marker.id, { title: event.target.value })}
                    />
                  </Field>
                  <ListControls
                    name={`spot ${index + 1}`}
                    index={index}
                    count={markers.length}
                    onMove={(to) => setMarkers(moveTo(markers, index, to))}
                    onRemove={() => setMarkers(markers.filter((item) => item.id !== marker.id))}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  {SIDES.map(([side, label]) => (
                    <Field key={side} label={label} className="w-40">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        value={marker[side]}
                        onChange={(event) =>
                          update(marker.id, { [side]: toPercent(event.target.value) })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <RichTextField
                  label="Note"
                  hint="Shown when the spot is opened."
                  value={marker.text}
                  course={course}
                  onChange={(text) => update(marker.id, { text })}
                />
              </fieldset>
            </li>
          ))}
        </ol>
      )}
      <AddButton
        full={markers.length >= LIMITS.markers}
        max={LIMITS.markers}
        onAdd={() => setMarkers([...markers, { id: newId(), x: 50, y: 50, title: '', text: [] }])}
      >
        Add a spot
      </AddButton>
    </div>
  );
}
