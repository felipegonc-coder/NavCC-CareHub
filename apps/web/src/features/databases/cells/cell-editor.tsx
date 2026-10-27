import { VALUE_MESSAGES, parseTyped, type ValueResult } from '@carehub/databases/values';
import { Checkbox, Input, Textarea } from '@carehub/ui';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CellView } from './cell-view';
import { ChecklistEditor } from './checklist-editor';
import { DateEditor } from './date-editor';
import { EditorShell } from './editor-shell';
import { FilesEditor } from './files-editor';
import { EditorAnchor } from './overlay';
import { commitDetails, editText } from './logic';
import { OptionEditor, PersonEditor, RelationEditor } from './pickers';
import type { CellEditorProps, CellMove } from './types';

/**
 * Edits one cell. Enter saves (Shift+Enter starts a new line in Text), Escape leaves without
 * saving, Tab and Shift+Tab save and move on, and a press outside saves. Formulas, rollups,
 * created and edited time and by, IDs and buttons can't be edited. Key it by row and property:
 * it starts from `value` when it opens.
 */
export function CellEditor(props: CellEditorProps) {
  return <EditorAnchor value={props.anchor ?? null}>{editorFor(props)}</EditorAnchor>;
}

function editorFor(props: CellEditorProps): ReactNode {
  switch (props.property.config.type) {
    case 'title':
    case 'text':
    case 'number':
    case 'url':
    case 'email':
    case 'phone':
      return <TextEditor {...props} />;
    case 'select':
    case 'multi_select':
    case 'status':
      return <OptionEditor {...props} />;
    case 'person':
      return <PersonEditor {...props} />;
    case 'relation':
      return <RelationEditor {...props} />;
    case 'date':
      return <DateEditor {...props} />;
    case 'checkbox':
      return <CheckboxEditor {...props} />;
    case 'files':
      return <FilesEditor {...props} />;
    case 'checklist':
      return <ChecklistEditor {...props} />;
    default:
      return <ReadOnlyEditor {...props} />;
  }
}

const INPUT_MODES = { number: 'decimal', url: 'url', email: 'email', phone: 'tel' } as const;

function TextEditor({ property, value, ctx, initialText, onCommit, onCancel }: CellEditorProps) {
  const type = property.config.type;
  const multiline = type === 'text';
  const [text, setText] = useState(() => initialText ?? editText(property, value));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const read = (): ValueResult => {
    // Unchanged text keeps its marks, links and mentions.
    if (multiline && Array.isArray(value) && text === editText(property, value)) {
      return { ok: true, value };
    }
    const res = parseTyped(property, text, ctx.viewer);
    return res.ok && type === 'title' ? { ok: true, value: res.value ?? '' } : res;
  };
  const commit = (move?: CellMove): boolean => {
    const res = read();
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onCommit(res.value, commitDetails(type === 'title' ? (value ?? '') : value, res.value, move));
    return true;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || (multiline && e.shiftKey)) return;
    e.preventDefault();
    e.stopPropagation();
    commit();
  };
  const field = {
    value: text,
    'aria-label': property.name,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      setError(null);
    },
    onKeyDown,
  };
  return (
    <EditorShell
      label={property.name}
      commit={commit}
      onOutside={() => {
        if (!commit()) onCancel();
      }}
      onCancel={() => onCancel()}
      initialFocus={multiline ? area : input}
      className="w-[var(--radix-popover-trigger-width)] min-w-72"
    >
      {multiline ? (
        <Textarea ref={area} rows={3} {...field} />
      ) : (
        <Input
          ref={input}
          type="text"
          autoComplete="off"
          inputMode={
            type in INPUT_MODES ? INPUT_MODES[type as keyof typeof INPUT_MODES] : undefined
          }
          {...field}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="px-1 text-small text-danger">
          {error}
        </p>
      )}
    </EditorShell>
  );
}

function CheckboxEditor({ property, value, onCommit, onCancel }: CellEditorProps) {
  const checked = value === true;
  const box = useRef<HTMLButtonElement>(null);
  const save = (next: boolean, move?: CellMove) =>
    onCommit(next, commitDetails(checked, next, move));
  return (
    <EditorShell
      label={property.name}
      commit={(move) => save(checked, move)}
      onOutside={() => onCancel()}
      onCancel={() => onCancel()}
      initialFocus={box}
      className="w-auto"
    >
      <span className="flex items-center gap-2 px-1 py-0.5">
        <Checkbox
          ref={box}
          checked={checked}
          aria-label={property.name}
          onCheckedChange={(next) => save(next === true)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            save(!checked);
          }}
        />
      </span>
    </EditorShell>
  );
}

/**
 * Formulas, rollups, created and edited time and by, IDs, buttons and verifications: shown, never
 * edited.
 */
function ReadOnlyEditor({
  property,
  value,
  ctx,
  onCancel,
  onPress,
  pressBlockedReason,
}: CellEditorProps) {
  const button = property.config.type === 'button';
  return (
    <EditorShell
      label={property.name}
      commit={(move) => onCancel(move ? { move } : undefined)}
      onOutside={() => onCancel()}
      onCancel={() => onCancel()}
      onEnter={() => onCancel()}
    >
      <span className="flex min-w-0 px-1 py-0.5">
        <CellView
          property={property}
          value={value}
          ctx={ctx}
          wrap
          onPress={onPress}
          pressBlockedReason={pressBlockedReason}
        />
      </span>
      {!button && <p className="px-1 text-small text-muted">{VALUE_MESSAGES.readOnly}</p>}
    </EditorShell>
  );
}
