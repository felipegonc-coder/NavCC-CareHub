import {
  BLOCK_GROUPS,
  HttpsUrlSchema,
  newBlockFromCatalog,
  searchBlockCatalog,
} from '@carehub/learning';
import type { Block, BlockCatalogEntry, BlockNeed, BlockSeed } from '@carehub/learning';
import { Button, Card, Field, Input } from '@carehub/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

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
  'flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-fill-hover disabled:text-faint';

function AddressForm(props: {
  entry: BlockCatalogEntry;
  onAdd(block: Block): void;
  onBack(): void;
}) {
  const ask = props.entry.need && props.entry.need !== 'file' ? ASK[props.entry.need] : null;
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
        <Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
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

/** The add-block menu: every block type by group, with search. Escape or Cancel closes it. */
export function BlockPicker({ onAdd, onClose }: { onAdd(block: Block): void; onClose(): void }) {
  const headingId = useId();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState<BlockCatalogEntry | null>(null);
  useEffect(() => search.current?.focus(), []);
  const found = searchBlockCatalog(query);
  const pick = (entry: BlockCatalogEntry) =>
    entry.need ? setAsking(entry) : onAdd(newBlockFromCatalog(entry));

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 shadow-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-body font-semibold text-fg">
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
          <Field label="Search blocks">
            <Input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {found.length === 0 && (
            <p className="text-small text-muted">No blocks match “{query}”.</p>
          )}
          {BLOCK_GROUPS.map((group) => {
            const entries = found.filter((entry) => entry.group === group);
            if (entries.length === 0) return null;
            return (
              <section key={group} className="flex flex-col gap-1">
                <h4 className="text-small font-semibold text-muted">{group}</h4>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {entries.map((entry) => (
                    <li key={entry.key}>
                      <button
                        type="button"
                        className={entryClasses}
                        disabled={entry.need === 'file'}
                        onClick={() => pick(entry)}
                      >
                        <span className="text-small font-medium text-fg">{entry.label}</span>
                        <span className="text-small text-muted">
                          {entry.need === 'file'
                            ? 'Available once file uploads are ready.'
                            : entry.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </Card>
  );
}
