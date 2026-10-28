import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, buttonClasses } from '@carehub/ui';
import {
  LIMITS,
  type FormDefinition,
  type Id,
  type Property,
  type Viewer,
} from '@carehub/databases';
import { anonymityWarning, formAudience, type FormAudience } from '@carehub/databases/forms';
import { useDatabaseClient, databaseKeys } from '../databases/hooks';
import { problemText, useFormsClient } from './api';
import { CommitInput, NativeSelect, SwitchField } from './controls';
import { RichTextField } from './rich-editor';
import {
  closeAtFromValue,
  closeAtValue,
  formUrl,
  maxResponsesFrom,
  withNotify,
} from './definition';
import { uploadingText } from './answers';
import { formUploadScope, toFileRef } from './uploads';

/** Under settings only people with Full access on the database may change. */
export const FULL_ACCESS_HINT = 'Needs Full access on the database.';
const ONE_RESPONSE_NEEDS_NAMES =
  'One response per person needs names. Turn off anonymous responses first.';
const ANYONE_RESPONDS_MORE = "Forms anyone can fill in can't limit responses per person.";
const ANYONE_IS_ANONYMOUS = 'Forms anyone can fill in are always anonymous.';
const ANYONE_HINT = 'No sign-in. Always anonymous, with no Person or Relation questions.';

const hints = (...parts: (string | null | undefined)[]): string | undefined =>
  parts.filter(Boolean).join(' ') || undefined;

function TextField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className="text-small font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface FormSettingsProps {
  id: string;
  def: FormDefinition;
  formId: Id;
  viewer: Viewer;
  properties: readonly Property[];
  /** Full access on the database: anonymous responses and closing. */
  fullAccess: boolean;
  onSave(next: FormDefinition): void;
}

/**
 * Settings (Forms spec, Builder): submit button label, confirmation message, more than one
 * response, notify me, anonymous responses, closing at a date or after a number of responses,
 * cover and icon.
 */
export function FormSettings({
  id,
  def,
  formId,
  viewer,
  properties,
  fullAccess,
  onSave,
}: FormSettingsProps) {
  const [limitProblem, setLimitProblem] = useState<string | null>(null);
  const needsFull = fullAccess ? undefined : FULL_ACCESS_HINT;
  const anyone = formAudience(def) === 'anyone';
  const oneResponseBlocked = (def.anonymous || anyone) && def.allowMultiple;

  return (
    <aside
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex w-full shrink-0 flex-col gap-4 rounded border border-border bg-bg p-4 md:w-80"
    >
      <h2 id={`${id}-title`} className="text-h3 text-fg">
        Settings
      </h2>
      <TextField id={`${id}-submit`} label="Submit button label">
        <CommitInput
          id={`${id}-submit`}
          value={def.submitLabel}
          maxLength={100}
          onCommit={(label) => onSave({ ...def, submitLabel: label.trim() || 'Submit' })}
        />
      </TextField>
      <TextField id={`${id}-confirmation`} label="Confirmation message">
        <RichTextField
          id={`${id}-confirmation`}
          aria-labelledby={`${id}-confirmation-label`}
          maxLength={LIMITS.formDescription}
          value={def.confirmation}
          onCommit={(confirmation) => onSave({ ...def, confirmation })}
        />
      </TextField>
      <SwitchField
        id={`${id}-multiple`}
        label="Allow more than one response"
        checked={def.allowMultiple}
        disabled={oneResponseBlocked}
        hint={
          oneResponseBlocked
            ? anyone
              ? ANYONE_RESPONDS_MORE
              : ONE_RESPONSE_NEEDS_NAMES
            : undefined
        }
        onChange={(allowMultiple) => onSave({ ...def, allowMultiple })}
      />
      <SwitchField
        id={`${id}-notify`}
        label="Notify me about new responses"
        checked={def.notifyUserIds.includes(viewer.userId)}
        onChange={(on) => onSave(withNotify(def, viewer.userId, on))}
      />
      <SwitchField
        id={`${id}-anonymous`}
        label="Anonymous responses"
        checked={def.anonymous || anyone}
        disabled={!fullAccess || anyone}
        hint={hints(
          anyone ? ANYONE_IS_ANONYMOUS : null,
          anonymityWarning(def, properties),
          needsFull,
        )}
        onChange={(anonymous) => onSave({ ...def, anonymous })}
      />
      <TextField id={`${id}-close-at`} label="Close at a date" hint={needsFull}>
        <CommitInput
          id={`${id}-close-at`}
          type="datetime-local"
          disabled={!fullAccess}
          aria-describedby={needsFull ? `${id}-close-at-hint` : undefined}
          value={closeAtValue(def.closeAt, viewer.timeZone)}
          onCommit={(v) => onSave({ ...def, closeAt: closeAtFromValue(v, viewer.timeZone) })}
        />
      </TextField>
      <TextField
        id={`${id}-limit`}
        label="Close after a number of responses"
        hint={hints(limitProblem, needsFull)}
      >
        <CommitInput
          id={`${id}-limit`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          disabled={!fullAccess}
          aria-invalid={limitProblem ? true : undefined}
          aria-describedby={limitProblem || needsFull ? `${id}-limit-hint` : undefined}
          value={def.maxResponses ? String(def.maxResponses) : ''}
          onCommit={(v) => {
            const maxResponses = maxResponsesFrom(v);
            if (maxResponses === undefined) {
              setLimitProblem('Enter a number.');
              return;
            }
            setLimitProblem(null);
            onSave({ ...def, maxResponses });
          }}
        />
      </TextField>
      <TextField id={`${id}-icon`} label="Icon">
        <CommitInput
          id={`${id}-icon`}
          className="w-20"
          maxLength={16}
          value={def.icon ?? ''}
          onCommit={(icon) => onSave({ ...def, icon: icon.trim() || null })}
        />
      </TextField>
      <CoverSetting id={`${id}-cover`} def={def} formId={formId} onSave={onSave} />
    </aside>
  );
}

/** Cover: an image uploaded through the files API, or none. */
function CoverSetting({
  id,
  def,
  formId,
  onSave,
}: {
  id: string;
  def: FormDefinition;
  formId: Id;
  onSave(next: FormDefinition): void;
}) {
  const client = useFormsClient();
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setProblem(null);
    try {
      const saved = await client.uploadFile(file, { scope: formUploadScope(formId) });
      onSave({ ...def, cover: toFileRef(saved) });
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-medium text-fg">
        Cover
      </label>
      {def.cover ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-small text-fg">{def.cover.name}</span>
          <Button id={id} variant="ghost" size="sm" onClick={() => onSave({ ...def, cover: null })}>
            Remove cover
          </Button>
        </div>
      ) : (
        <input
          id={id}
          type="file"
          accept="image/*"
          disabled={uploading}
          className="text-small text-fg"
          onChange={(event) => void pick(event)}
        />
      )}
      {uploading && <p className="text-small text-muted">{uploadingText(1)}</p>}
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

const AUDIENCE_LABELS: Record<FormAudience, string> = {
  members: 'Workspace members',
  members_and_guests: 'Members and guests',
  anyone: 'Anyone on the Care Hub network with the link',
};
const AUDIENCES = ['members', 'members_and_guests', 'anyone'] as const;

export interface ShareFormProps {
  def: FormDefinition;
  databaseId: Id;
  viewId: Id;
  /** Accept responses on or off and Change link need Full access; so does Who can respond. */
  fullAccess: boolean;
  onSave(next: FormDefinition): void;
}

/**
 * Share form: Accept responses, the link with Copy link and Change link, and Who can respond
 * (members, members and guests, or anyone on the network with the link, without signing in).
 */
export function ShareForm({ def, databaseId, viewId, fullAccess, onSave }: ShareFormProps) {
  const id = useId();
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The new code shows at once; the saved form catches up when the database reloads.
  const [changed, setChanged] = useState<{ from: string; to: string } | null>(null);
  const code = changed && changed.from === def.linkCode ? changed.to : def.linkCode;
  const url = formUrl(code, window.location.origin);
  const audience = formAudience(def);
  const needsFull = fullAccess ? undefined : FULL_ACCESS_HINT;
  const audienceHint = hints(audience === 'anyone' ? ANYONE_HINT : null, needsFull);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard here: select the link so it can be copied by hand.
      const box = document.getElementById(`${id}-link`);
      if (box instanceof HTMLInputElement) box.select();
    }
  }

  async function changeLink() {
    setChanging(true);
    setProblem(null);
    try {
      const link = await client.changeFormLink(databaseId, viewId);
      setChanged({ from: def.linkCode, to: link.linkCode });
      setConfirming(false);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: databaseKeys.all(databaseId) });
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setChanging(false);
    }
  }

  return (
    <Popover
      onOpenChange={() => {
        setCopied(false);
        setConfirming(false);
        setProblem(null);
      }}
    >
      <PopoverTrigger className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
        Share form
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Share form" className="flex w-80 flex-col gap-4">
        <SwitchField
          id={`${id}-accepting`}
          label="Accept responses"
          checked={def.accepting}
          disabled={!fullAccess}
          hint={needsFull}
          onChange={(accepting) => onSave({ ...def, accepting })}
        />
        <TextField id={`${id}-link`} label="Form link">
          <Input
            id={`${id}-link`}
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
          />
        </TextField>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void copy()}>
            Copy link
          </Button>
          {fullAccess && !confirming && (
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Change link
            </Button>
          )}
        </div>
        <p role="status" className="text-small text-muted">
          {copied ? 'Link copied' : ''}
        </p>
        {confirming && (
          <div role="group" aria-label="Change link" className="flex flex-col gap-2">
            <p className="text-small text-fg">The old link stops working at once.</p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={changing}
                onClick={() => void changeLink()}
              >
                Change link
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {problem && (
          <p role="alert" className="text-small text-danger">
            {problem}
          </p>
        )}
        <TextField id={`${id}-audience`} label="Who can respond" hint={audienceHint}>
          <NativeSelect
            id={`${id}-audience`}
            value={audience}
            disabled={!fullAccess}
            aria-describedby={audienceHint ? `${id}-audience-hint` : undefined}
            onChange={(event) => {
              const next = AUDIENCES.find((a) => a === event.target.value);
              if (!next) return;
              // Anyone can fill it in: always anonymous, with no limit of one response per person
              // (Forms spec). Anonymous stays on if the form goes back to members, until an editor
              // turns it off.
              onSave({
                ...def,
                audience: next,
                ...(next === 'anyone' ? { anonymous: true, allowMultiple: true } : {}),
              });
            }}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </NativeSelect>
        </TextField>
      </PopoverContent>
    </Popover>
  );
}
