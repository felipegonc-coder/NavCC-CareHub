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

// Blocks that need a picture, media or address ask for a web address until uploads and the media picker
// land; file downloads wait for uploads.
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

/**
 * The add-block menu: every block type by group, with search. Arrow keys move through the blocks (Down from the
 * search box enters the menu, Enter there adds the first match); Escape or Cancel closes it.
 */
export function BlockPicker({ onAdd, onClose }: { onAdd(block: Block): void; onClose(): void }) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState<BlockCatalogEntry | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!asking) search.current?.focus();
  }, [asking]);
  const found = searchBlockCatalog(query);
  const groups = BLOCK_GROUPS.map((group) => ({
    group,
    entries: found.filter((entry) => entry.group === group),
  })).filter(({ entries }) => entries.length > 0);
  const ordered = groups.flatMap(({ entries }) => entries);
  const pick = (entry: BlockCatalogEntry) => {
    if (entry.need === 'file') return;
    if (entry.need) setAsking(entry);
    else onAdd(newBlockFromCatalog(entry));
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
          Add a block
        </h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {asking ? (
        <AddressForm entry={asking} onAdd={onAdd} onBack={() => setAsking(null)} />
      ) : (
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
                } else if (event.key === 'Enter' && ordered[0]) {
                  event.preventDefault();
                  pick(ordered[0]);
                }
              }}
            />
          </Field>
          {found.length === 0 && (
            <p className="text-small text-muted">No blocks match “{query}”.</p>
          )}
          <div
            ref={menu}
            role="menu"
            aria-labelledby={`${id}-title`}
            className="flex flex-col gap-2 empty:hidden"
          >
            {groups.map(({ group, entries }, g) => (
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
                  {entries.map((entry) => {
                    const index = ordered.indexOf(entry);
                    const file = entry.need === 'file';
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        role="menuitem"
                        tabIndex={index === active ? 0 : -1}
                        aria-disabled={file || undefined}
                        aria-describedby={`${id}-i${index}-about`}
                        className={entryClasses}
                        onFocus={() => setActive(index)}
                        onKeyDown={moveFocus}
                        onClick={() => pick(entry)}
                      >
                        <span className="text-small font-medium text-fg">{entry.label}</span>
                        {/* Read as the description, so the name is just the visible title. */}
                        <span
                          id={`${id}-i${index}-about`}
                          aria-hidden="true"
                          className="text-small text-muted"
                        >
                          {file ? 'Available once file uploads are ready.' : entry.description}
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
