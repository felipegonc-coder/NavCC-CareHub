// The fields of each kind of step in a button's settings (spec 3.4).
import type { DatabaseMeta } from '@carehub/databases';
import {
  BUTTON_LIMITS,
  type ButtonAction,
  type ButtonActionKind,
} from '@carehub/extras/templates/buttons';
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@carehub/ui';
import { useEffect, useState } from 'react';
import { useButtonDatabase } from './api';
import { BlocksField } from './blocks-field';
import { pageIdFromLink } from './page-id';
import { ValuesField } from './values-field';
import { filterProperties, fromFilter, namesFor, optionsOf, toFilter } from './values';

type Of<K extends ButtonActionKind> = Extract<ButtonAction, { kind: K }>;

/** A new step of this kind; Open a page starts on the row an earlier step adds, if there is one. */
export function newAction(kind: ButtonActionKind, rowMadeBefore: boolean): ButtonAction {
  switch (kind) {
    case 'insert_blocks':
      return { kind, where: 'below', blocks: [] };
    case 'add_row':
      return { kind, databaseId: '', templateId: null, values: {} };
    case 'edit_rows':
      return { kind, databaseId: '', filter: null, values: {} };
    case 'open_page':
      return { kind, pageId: rowMadeBefore ? null : '', openIn: 'this_tab' };
    case 'open_link':
      return { kind, url: '' };
    case 'send_message':
      return {
        kind,
        to: { userIds: [], groupIds: [], roleIds: [], everyone: false },
        message: '',
        card: 'this_page',
      };
    case 'confirm':
      return { kind, title: 'Are you sure?', message: '', confirmLabel: 'Continue' };
  }
}

/** The step number of the last Add a row before `index`, or null. */
export function rowStepBefore(actions: readonly ButtonAction[], index: number): number | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (actions[at]?.kind === 'add_row') return at + 1;
  }
  return null;
}

function DatabaseField({
  databaseId,
  meta,
  loading,
  failed,
  onChange,
}: {
  databaseId: string;
  meta: DatabaseMeta | undefined;
  loading: boolean;
  failed: boolean;
  onChange(databaseId: string): void;
}) {
  const [text, setText] = useState(databaseId);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    if (!text.trim()) {
      setProblem(null);
      if (databaseId) onChange('');
      return;
    }
    const id = pageIdFromLink(text);
    if (!id) return setProblem('Paste the link to a database.');
    setProblem(null);
    if (id !== databaseId) onChange(id);
  };
  let hint = 'Paste the database’s link (Copy link, in its ••• menu).';
  if (databaseId && loading) hint = 'Finding the database…';
  if (databaseId && meta) hint = `Database: ${meta.title || 'Untitled'}`;
  return (
    <Field
      label="Database"
      hint={hint}
      error={
        problem ??
        (databaseId && failed
          ? 'Couldn’t open that database. Check the link and that you can see it.'
          : undefined)
      }
    >
      <Input
        value={text}
        placeholder="Link to the database"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
    </Field>
  );
}

function PageField({ pageId, onChange }: { pageId: string; onChange(pageId: string): void }) {
  const [text, setText] = useState(pageId);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    const id = pageIdFromLink(text);
    if (text.trim() && !id) return setProblem('Paste the link to a page.');
    setProblem(null);
    onChange(id ?? '');
  };
  return (
    <Field label="Page" hint="Paste the page’s link (Copy link, in its ••• menu)." error={problem}>
      <Input
        value={text}
        placeholder="Link to the page"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
    </Field>
  );
}

function InsertBlocksFields({
  action,
  step,
  onChange,
}: {
  action: Of<'insert_blocks'>;
  step: number;
  onChange(action: ButtonAction): void;
}) {
  return (
    <>
      <Field label="Where">
        <Select
          value={action.where}
          onValueChange={(where: string) =>
            onChange({ ...action, where: where === 'above' ? 'above' : 'below' })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="above">Above the button</SelectItem>
            <SelectItem value="below">Below the button</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <BlocksField
        label={`Blocks step ${step} inserts`}
        blocks={action.blocks}
        onChange={(blocks) => onChange({ ...action, blocks })}
      />
    </>
  );
}

function RowFields({
  action,
  onChange,
}: {
  action: Of<'add_row'> | Of<'edit_rows'>;
  onChange(action: ButtonAction): void;
}) {
  const database = useButtonDatabase(action.databaseId || null);
  const meta = database.data;
  const rows = action.kind === 'edit_rows' ? fromFilter(action.filter) : null;

  // The names the plain sentence uses ("add a row to Tickets with Status New"), kept with the step.
  useEffect(() => {
    if (!meta) return;
    const names = namesFor(action, meta);
    if (JSON.stringify(names) !== JSON.stringify(action.names ?? null))
      onChange({ ...action, names });
  }, [meta, action, onChange]);
  const byProperty = rows ? meta?.properties.find((item) => item.id === rows.propertyId) : null;

  return (
    <>
      <DatabaseField
        databaseId={action.databaseId}
        meta={meta}
        loading={database.isLoading}
        failed={database.isError}
        onChange={(databaseId) =>
          onChange(
            action.kind === 'add_row'
              ? { ...action, databaseId, templateId: null, values: {} }
              : { ...action, databaseId, filter: null, values: {} },
          )
        }
      />
      {meta && action.kind === 'add_row' && meta.templates.length > 0 && (
        <Field label="Template">
          <Select
            value={action.templateId ?? 'none'}
            onValueChange={(templateId: string) =>
              onChange({ ...action, templateId: templateId === 'none' ? null : templateId })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Empty row</SelectItem>
              {meta.templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {meta && action.kind === 'edit_rows' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Rows to change" className="min-w-0 flex-1">
            <Select
              value={rows === undefined ? 'kept' : (rows?.propertyId ?? 'all')}
              onValueChange={(choice: string) => {
                if (choice === 'kept') return;
                const property = meta.properties.find((item) => item.id === choice);
                if (!property) return onChange({ ...action, filter: null });
                const first =
                  property.config.type === 'checkbox'
                    ? 'checked'
                    : property.config.type === 'person'
                      ? 'me'
                      : (optionsOf(property)[0]?.id ?? '');
                onChange({ ...action, filter: toFilter(property, first) });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every row</SelectItem>
                {rows === undefined && (
                  <SelectItem value="kept">Rows that match the filter set up before</SelectItem>
                )}
                {filterProperties(meta).map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    Rows where {property.name}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {rows && byProperty && byProperty.config.type !== 'person' && (
            <Field label={`${byProperty.name} is`} className="min-w-0 flex-1">
              <Select
                value={rows.value}
                onValueChange={(value: string) =>
                  onChange({ ...action, filter: toFilter(byProperty, value) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {byProperty.config.type === 'checkbox' ? (
                    <>
                      <SelectItem value="checked">Checked</SelectItem>
                      <SelectItem value="unchecked">Unchecked</SelectItem>
                    </>
                  ) : (
                    optionsOf(byProperty).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
          )}
          {rows && byProperty?.config.type === 'person' && (
            <p className="flex-1 pb-2 text-small">{byProperty.name} is the person who pressed it</p>
          )}
        </div>
      )}
      {meta && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-medium">
            {action.kind === 'add_row' ? 'Values' : 'Change'}
          </legend>
          <ValuesField
            meta={meta}
            values={action.values}
            onChange={(values) => onChange({ ...action, values })}
          />
        </fieldset>
      )}
    </>
  );
}

function OpenPageFields({
  action,
  rowStep,
  onChange,
}: {
  action: Of<'open_page'>;
  rowStep: number | null;
  onChange(action: ButtonAction): void;
}) {
  return (
    <>
      {rowStep !== null && (
        <Field label="Open">
          <Select
            value={action.pageId === null ? 'row' : 'page'}
            onValueChange={(choice: string) =>
              onChange({ ...action, pageId: choice === 'row' ? null : '' })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="row">The row step {rowStep} adds</SelectItem>
              <SelectItem value="page">A page</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      {action.pageId !== null && (
        <PageField pageId={action.pageId} onChange={(pageId) => onChange({ ...action, pageId })} />
      )}
      <Field label="Open in">
        <Select
          value={action.openIn}
          onValueChange={(openIn: string) =>
            onChange({ ...action, openIn: openIn === 'new_tab' ? 'new_tab' : 'this_tab' })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_tab">This tab</SelectItem>
            <SelectItem value="new_tab">A new tab</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

const FILL_INS = [
  { token: '{{me}}', label: 'Me' },
  { token: '{{today}}', label: 'Today' },
  { token: '{{now}}', label: 'Now' },
  { token: '{{this_page}}', label: 'This page' },
];

function SendMessageFields({
  action,
  rowStep,
  onChange,
}: {
  action: Of<'send_message'>;
  rowStep: number | null;
  onChange(action: ButtonAction): void;
}) {
  const add = (token: string) => {
    const gap = action.message && !action.message.endsWith(' ') ? ' ' : '';
    onChange({ ...action, message: `${action.message}${gap}${token}` });
  };
  return (
    <>
      <Field
        label="Send to everyone in the workspace"
        hint="Only Admins can send to everyone. Choosing people and groups comes later."
        layout="inline"
      >
        <Switch
          checked={action.to.everyone}
          onCheckedChange={(everyone: boolean) =>
            onChange({ ...action, to: { ...action.to, everyone } })
          }
        />
      </Field>
      <Field label="Message" hint="Sent as a 🔔 notice.">
        <Textarea
          rows={3}
          maxLength={BUTTON_LIMITS.message}
          value={action.message}
          onChange={(event) => onChange({ ...action, message: event.target.value })}
        />
      </Field>
      <div role="group" aria-label="Fill-ins" className="flex flex-wrap items-center gap-1">
        <span className="text-small text-muted">Fill in:</span>
        {FILL_INS.map(({ token, label }) => (
          <Button
            key={token}
            variant="ghost"
            size="sm"
            className="text-purple-text"
            onClick={() => add(token)}
          >
            @{label}
          </Button>
        ))}
      </div>
      <Field label="Card under the message">
        <Select
          value={action.card ?? 'none'}
          onValueChange={(card: string) =>
            onChange({
              ...action,
              card: card === 'this_page' || card === 'new_row' ? card : null,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No card</SelectItem>
            <SelectItem value="this_page">This page</SelectItem>
            {rowStep !== null && (
              <SelectItem value="new_row">The row step {rowStep} adds</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

function ConfirmFields({
  action,
  onChange,
}: {
  action: Of<'confirm'>;
  onChange(action: ButtonAction): void;
}) {
  return (
    <>
      <Field label="Title">
        <Input
          value={action.title}
          maxLength={BUTTON_LIMITS.confirmTitle}
          onChange={(event) => onChange({ ...action, title: event.target.value })}
        />
      </Field>
      <Field label="Text">
        <Textarea
          rows={2}
          value={action.message}
          maxLength={BUTTON_LIMITS.confirmText}
          onChange={(event) => onChange({ ...action, message: event.target.value })}
        />
      </Field>
      <Field label="Button label" hint="Cancel stops the button.">
        <Input
          value={action.confirmLabel}
          maxLength={BUTTON_LIMITS.confirmLabel}
          onChange={(event) => onChange({ ...action, confirmLabel: event.target.value })}
        />
      </Field>
    </>
  );
}

export interface ActionFieldsProps {
  action: ButtonAction;
  /** 0-based. */
  index: number;
  actions: readonly ButtonAction[];
  onChange(action: ButtonAction): void;
}

/** The fields of one step, under its name ("2. Add a row"). */
export function ActionFields({ action, index, actions, onChange }: ActionFieldsProps) {
  const rowStep = rowStepBefore(actions, index);
  switch (action.kind) {
    case 'insert_blocks':
      return <InsertBlocksFields action={action} step={index + 1} onChange={onChange} />;
    case 'add_row':
    case 'edit_rows':
      return <RowFields action={action} onChange={onChange} />;
    case 'open_page':
      return <OpenPageFields action={action} rowStep={rowStep} onChange={onChange} />;
    case 'open_link':
      return (
        <Field label="Link" hint="Opens in a new tab. It must start with https:// or http://.">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={action.url}
            maxLength={BUTTON_LIMITS.url}
            onChange={(event) => onChange({ ...action, url: event.target.value })}
          />
        </Field>
      );
    case 'send_message':
      return <SendMessageFields action={action} rowStep={rowStep} onChange={onChange} />;
    case 'confirm':
      return <ConfirmFields action={action} onChange={onChange} />;
  }
}
