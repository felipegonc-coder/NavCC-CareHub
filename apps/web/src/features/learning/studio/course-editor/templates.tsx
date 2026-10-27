import type { Block, Id } from '@carehub/learning';
import { Button, Field, Input } from '@carehub/ui';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useBlockTemplates, useDeleteBlockTemplate, useSaveBlockTemplate } from '../data/queries';
import { blocksSummary } from '../labels';

/** Template names are cut to this length when saved. */
const NAME_LIMIT = 80;

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Saves `blocks` as a block template under a name the author picks (`name` to start with). `onDone` gets what to
 * announce: the saved message, or '' after Cancel.
 */
export function SaveTemplateForm(props: {
  blocks: readonly Block[];
  name: string;
  onDone(message: string): void;
}) {
  const save = useSaveBlockTemplate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const [name, setName] = useState(props.name.slice(0, NAME_LIMIT));
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the template a name.');
      return;
    }
    try {
      const template = await save.mutateAsync({ name: trimmed, blocks: [...props.blocks] });
      props.onDone(`Saved “${template.name}”. Find it under Templates in Add block.`);
    } catch (caught) {
      setError(messageOf(caught, "The template wasn't saved. Try again."));
    }
  };
  return (
    <form
      noValidate
      aria-label="Save as a template"
      className="flex flex-col gap-2 rounded border border-border p-3"
      onSubmit={submit}
    >
      <Field label="Template name" hint={blocksSummary(props.blocks)} error={error || undefined}>
        <Input
          ref={input}
          value={name}
          maxLength={NAME_LIMIT}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          Save template
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onDone('')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Manage templates" in the add-block menu: the saved templates, each with Delete (after a second click). */
export function TemplateManager({ onBack }: { onBack(): void }) {
  const templates = useBlockTemplates();
  const remove = useDeleteBlockTemplate();
  const back = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState<Id | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);
  const list = templates.data ?? [];
  const deleteTemplate = async (id: Id, name: string) => {
    try {
      await remove.mutateAsync(id);
      setStatus(`Deleted “${name}”.`);
    } catch (caught) {
      setStatus(messageOf(caught, `“${name}” wasn't deleted. Try again.`));
    }
    setConfirming(null);
    back.current?.focus();
  };
  return (
    <div className="flex flex-col gap-2">
      {templates.isError ? (
        <p className="text-small text-muted">The templates can&apos;t be loaded right now.</p>
      ) : list.length === 0 && !templates.isPending ? (
        <p className="text-small text-muted">
          No templates yet. Save a block, or a lesson&apos;s blocks, as a template.
        </p>
      ) : (
        <ul aria-label="Templates" className="flex flex-col gap-2">
          {list.map((template) => (
            <li
              key={template.id}
              className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-small font-medium text-fg">{template.name}</span>
                <span className="text-small text-muted">{blocksSummary(template.blocks)}</span>
              </span>
              {confirming === template.id ? (
                <>
                  <Button
                    ref={confirm}
                    size="sm"
                    variant="danger"
                    loading={remove.isPending}
                    onClick={() => void deleteTemplate(template.id, template.name)}
                  >
                    Delete “{template.name}”
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${template.name}`}
                  onClick={() => setConfirming(template.id)}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="text-small text-fg empty:hidden">
        {status}
      </p>
      <Button ref={back} size="sm" variant="ghost" className="self-start" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
