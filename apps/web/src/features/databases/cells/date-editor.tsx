import { isValidDateValue } from '@carehub/databases';
import { VALUE_MESSAGES, validateValue } from '@carehub/databases/values';
import { Button, Field, Input, Switch } from '@carehub/ui';
import { useRef, useState, type KeyboardEvent } from 'react';
import { NativeSelect } from './controls';
import { EditorShell } from './editor-shell';
import {
  commitDetails,
  dateDraft,
  draftValue,
  reminderChoices,
  timeZoneChoices,
  type DateDraft,
} from './logic';
import { CELL_TEXT } from './messages';
import type { CellEditorProps, CellMove } from './types';

/**
 * Date: a start, an optional end and an optional time (switches), a fixed time zone for dates
 * with a time, and a reminder. An end before the start is refused.
 */
export function DateEditor({ property, value, ctx, onCommit, onCancel }: CellEditorProps) {
  const [draft, setDraft] = useState<DateDraft>(() =>
    dateDraft(isValidDateValue(value) ? value : null, ctx.viewer),
  );
  const [zones] = useState(() => timeZoneChoices(draft.timeZone));
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<DateDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const save = (next: unknown, move?: CellMove) =>
    onCommit(next, commitDetails(value ?? null, next, move));
  const commit = (move?: CellMove): boolean => {
    const input = draftValue(draft, ctx.viewer);
    const res = input === undefined ? null : validateValue(property, input);
    if (!res || !res.ok) {
      setError(res ? res.error : VALUE_MESSAGES.date);
      return false;
    }
    save(res.value, move);
    return true;
  };
  const onEnter = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    commit();
  };
  const hasEnd = draft.end !== null;
  return (
    <EditorShell
      label={property.name}
      commit={commit}
      onOutside={() => {
        if (!commit()) onCancel();
      }}
      onCancel={() => onCancel()}
      initialFocus={first}
      className="gap-2 p-2"
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label={hasEnd ? CELL_TEXT.start : CELL_TEXT.date}>
          <Input
            ref={first}
            type="date"
            value={draft.start}
            onChange={(e) => set({ start: e.target.value })}
            onKeyDown={onEnter}
          />
        </Field>
        {draft.hasTime && (
          <Field label={CELL_TEXT.startTime}>
            <Input
              type="time"
              value={draft.startTime}
              onChange={(e) => set({ startTime: e.target.value })}
              onKeyDown={onEnter}
            />
          </Field>
        )}
        {draft.end !== null && (
          <Field label={CELL_TEXT.end} className="col-start-1">
            <Input
              type="date"
              value={draft.end}
              onChange={(e) => set({ end: e.target.value })}
              onKeyDown={onEnter}
            />
          </Field>
        )}
        {hasEnd && draft.hasTime && (
          <Field label={CELL_TEXT.endTime}>
            <Input
              type="time"
              value={draft.endTime}
              onChange={(e) => set({ endTime: e.target.value })}
              onKeyDown={onEnter}
            />
          </Field>
        )}
      </div>
      <Field label={CELL_TEXT.endDate} layout="inline">
        <Switch
          checked={hasEnd}
          onCheckedChange={(on) => set({ end: on ? (draft.end ?? draft.start) : null })}
        />
      </Field>
      <Field label={CELL_TEXT.includeTime} layout="inline">
        <Switch
          checked={draft.hasTime}
          onCheckedChange={(on) => set({ hasTime: on, reminder: '', timeZone: '' })}
        />
      </Field>
      {draft.hasTime && (
        <Field label={CELL_TEXT.timeZone}>
          <NativeSelect
            value={draft.timeZone}
            onChange={(e) => set({ timeZone: e.target.value })}
            onKeyDown={onEnter}
          >
            <option value="">{CELL_TEXT.viewerTimeZone}</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field label={CELL_TEXT.remind}>
        <NativeSelect
          value={draft.reminder}
          onChange={(e) => set({ reminder: e.target.value })}
          onKeyDown={onEnter}
        >
          {reminderChoices(draft.hasTime, draft.reminder).map((choice) => (
            <option key={choice.key} value={choice.key}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => save(null)}>
          {CELL_TEXT.clear}
        </Button>
      </div>
    </EditorShell>
  );
}
