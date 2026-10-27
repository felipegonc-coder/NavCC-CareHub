import {
  BLOCK_GROUPS,
  HttpsUrlSchema,
  newBlockFromCatalog,
  searchBlockCatalog,
} from '@carehub/learning';
import type { Block, BlockCatalogEntry, BlockNeed, BlockSeed } from '@carehub/learning';
import { Button, Card, Field, Input } from '@carehub/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { BlockTemplate } from '../data/client';
import { useBlockTemplates } from '../data/queries';
import { blocksSummary } from '../labels';
import { PasteForm } from './PasteForm';
import { TemplateManager } from './templates';

// Blocks that need a picture, media or address ask for a web address until uploads and the media picker
// (B10) land; file downloads wait for uploads.
const ASK: Record<Exclude<BlockNeed, 'file'>, { label: string; seed(url: string): BlockSeed }> = {
  image: {
    label: 'Picture address',
    seed: (url) => ({ image: { media: { kind: 'url', url }, alt: '' } }),
  },
  video: { label: 'Video address', seed: (url) => ({ media: { kind: 'url', url } }) },
  audio: { label: 'Audio address', seed: (url) => ({ media: { kind: 'url', url } }) },
  embed: { label: 'Web page address', seed: (url) => ({ url }) },
  link: { label: 'Link address', seed: (url) => ({ url }) },
};

const entryClasses =
  'flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-fill-hover focus-visible:bg-fill-hover aria-disabled:cursor-not-allowed aria-disabled:text-faint';

function AddressForm(props: {
  entry: BlockCatalogEntry;
  onAdd(block: Block): void;
  onBack(): void;
}) {
  const ask = props.entry.need && props.entry.need !== 'file' ? ASK[props.entry.need] : null;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    try {
      if (!ask) return;
      if (props.entry.need !== 'link' && !HttpsUrlSchema.safeParse(value).success) {
        throw new Error('Use a full https:// address.');
      }
      props.onAdd(newBlockFromCatalog(props.entry, undefined, ask.seed(value)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Check the address.');
    }
  };
  return (
    <form noValidate className="flex flex-col gap-2" onSubmit={submit}>
      <Field
        label={ask?.label ?? 'Address'}
        hint={
          props.entry.need === 'link' ? 'Starts with https:// or mailto:' : 'Starts with https://'
        }
        error={error || undefined}
      >
        <Input
          ref={input}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Add block
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}

type MenuItem =
  | { kind: 'block'; key: string; entry: BlockCatalogEntry }
  | { kind: 'template'; key: string; template: BlockTemplate }
  | { kind: 'paste' | 'manage'; key: string };

type Panel = { kind: 'address'; entry: BlockCatalogEntry } | { kind: 'paste' | 'manage' } | null;

function describe(item: MenuItem): { label: string; about: string } {
  switch (item.kind) {
    case 'block':
      return {
        label: item.entry.label,
        about:
          item.entry.need === 'file'
            ? 'Available once file uploads are ready.'
            : item.entry.description,
      };
    case 'template':
      return { label: item.template.name, about: blocksSummary(item.template.blocks) };
    case 'paste':
      return {
        label: 'Paste text',
        about: 'Turns pasted text into headings, paragraphs, lists and tables.',
      };
    case 'manage':
      return { label: 'Manage templates', about: 'See and delete the saved templates.' };
  }
}

/**
 * The add-block menu: every block type by group, the saved templates, and Paste text, with search. Arrow keys move
 * through the items (Down from the search box enters the menu, Enter there adds the first match); Escape or Cancel
 * closes it. `onAdd` gets the new blocks.
 */
export function BlockPicker({
  onAdd,
  onClose,
}: {
  onAdd(blocks: readonly Block[]): void;
  onClose(): void;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [active, setActive] = useState(0);
  const templates = useBlockTemplates().data ?? [];
  useEffect(() => {
    if (!panel) search.current?.focus();
  }, [panel]);
  const words = query.trim().toLocaleLowerCase();
  const found = searchBlockCatalog(query);
  const matching = templates.filter((t) => t.name.toLocaleLowerCase().includes(words));
  const more: MenuItem[] = [{ kind: 'paste', key: 'paste' }];
  if (templates.length > 0) more.push({ kind: 'manage', key: 'manage' });
  const groups = [
    ...BLOCK_GROUPS.map((group) => ({
      group: String(group),
      items: found
        .filter((entry) => entry.group === group)
        .map((entry): MenuItem => ({ kind: 'block', key: entry.key, entry })),
    })),
    {
      group: 'Templates',
      items: matching.map((template): MenuItem => ({
        kind: 'template',
        key: template.id,
        template,
      })),
    },
    { group: 'More', items: more },
  ].filter(({ items }) => items.length > 0);
  const ordered = groups.flatMap(({ items }) => items);
  const first = ordered.find((item) => item.kind === 'block' || item.kind === 'template');
  const pick = (item: MenuItem) => {
    if (item.kind === 'template') onAdd(item.template.blocks);
    else if (item.kind !== 'block') setPanel({ kind: item.kind });
    else if (item.entry.need === 'file') return;
    else if (item.entry.need) setPanel({ kind: 'address', entry: item.entry });
    else onAdd([newBlockFromCatalog(item.entry)]);
  };
  const focusItem = (index: number) => {
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [];
    const next = Math.min(Math.max(index, 0), items.length - 1);
    setActive(next);
    items[next]?.focus();
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: ordered.length - 1,
    };
    const to = keys[event.key];
    if (to === undefined) return;
    event.preventDefault();
    if (to < 0) search.current?.focus();
    else focusItem(to);
  };
  const back = () => setPanel(null);

  return (
    <Card
      role="region"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 shadow-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="text-body font-semibold text-fg">
          {panel?.kind === 'manage' ? 'Templates' : 'Add a block'}
        </h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {panel?.kind === 'address' && (
        <AddressForm entry={panel.entry} onAdd={(block) => onAdd([block])} onBack={back} />
      )}
      {panel?.kind === 'paste' && <PasteForm onAdd={onAdd} onBack={back} />}
      {panel?.kind === 'manage' && <TemplateManager onBack={back} />}
      {!panel && (
        <>
          <Field label="Search blocks" hint="Down arrow goes to the blocks, Enter adds the first.">
            <Input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && ordered.length > 0) {
                  event.preventDefault();
                  focusItem(0);
                } else if (event.key === 'Enter' && first) {
                  event.preventDefault();
                  pick(first);
                }
              }}
            />
          </Field>
          {!first && <p className="text-small text-muted">No blocks match “{query}”.</p>}
          <div
            ref={menu}
            role="menu"
            aria-labelledby={`${id}-title`}
            className="flex flex-col gap-2"
          >
            {groups.map(({ group, items }, g) => (
              <div
                key={group}
                role="group"
                aria-labelledby={`${id}-g${g}`}
                className="flex flex-col"
              >
                <span id={`${id}-g${g}`} className="px-2 text-small font-semibold text-muted">
                  {group}
                </span>
                <div className="grid gap-1 sm:grid-cols-2">
                  {items.map((item) => {
                    const index = ordered.indexOf(item);
                    const { label, about } = describe(item);
                    const file = item.kind === 'block' && item.entry.need === 'file';
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        tabIndex={index === active ? 0 : -1}
                        aria-disabled={file || undefined}
                        aria-labelledby={`${id}-i${index}`}
                        aria-describedby={`${id}-i${index}-about`}
                        className={entryClasses}
                        onFocus={() => setActive(index)}
                        onKeyDown={moveFocus}
                        onClick={() => pick(item)}
                      >
                        <span id={`${id}-i${index}`} className="text-small font-medium text-fg">
                          {label}
                        </span>
                        <span id={`${id}-i${index}-about`} className="text-small text-muted">
                          {about}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
