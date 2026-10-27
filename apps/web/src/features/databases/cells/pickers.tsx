import {
  STATUS_GROUPS,
  type ConfigOf,
  type Id,
  type SelectOption,
  type StatusOption,
} from '@carehub/databases';
import {
  findOptionByName,
  newOption,
  nextOptionColor,
  validateOptionName,
  type OptionConfig,
} from '@carehub/databases/options';
import { validateValue } from '@carehub/databases/values';
import { cn, Spinner } from '@carehub/ui';
import { Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { HiddenRowsChip, OptionChip, PersonChip, RowChip } from './chips';
import { EditorShell } from './editor-shell';
import { commitDetails, matchesQuery } from './logic';
import { CELL_TEXT, STATUS_GROUP_LABELS } from './messages';
import type { CellEditorProps, CellMove, RowChoice } from './types';

const MENU_ITEM =
  'relative flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-small text-fg outline-none';

interface PickerItem {
  key: string;
  /** What screen readers hear for it. */
  label: string;
  node: ReactNode;
  /** Status options are listed under their group. */
  group?: string;
  selected?: boolean;
  onPick: () => void;
}

const toIds = (v: unknown): Id[] =>
  Array.isArray(v)
    ? v.filter((x): x is Id => typeof x === 'string')
    : typeof v === 'string' && v
      ? [v]
      : [];
const toggle = (ids: Id[], id: Id): Id[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** The ✕ on a chosen value (Backspace in the search box removes the last one too). */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={CELL_TEXT.remove(label)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex shrink-0 items-center rounded-sm opacity-70 hover:opacity-100"
    >
      <X aria-hidden className="size-3" />
    </button>
  );
}

interface ListPickerProps {
  label: string;
  query: string;
  onQuery: (query: string) => void;
  /** The chosen values, shown above the search box. */
  chips: ReactNode[];
  items: PickerItem[];
  multiple: boolean;
  error: string | null;
  loading?: boolean;
  /** Enter with nothing highlighted, Tab, or a press outside: save the choice. */
  onSave: (move?: CellMove) => boolean;
  onCancel: () => void;
  onBackspace: () => void;
}

/**
 * A search box over a list. Arrow keys move the highlight, Enter picks the highlighted item
 * (with nothing highlighted, Enter saves); typing highlights the first match.
 */
function ListPicker({
  label,
  query,
  onQuery,
  chips,
  items,
  multiple,
  error,
  loading = false,
  onSave,
  onCancel,
  onBackspace,
}: ListPickerProps) {
  const listId = useId();
  const [active, setActive] = useState(query.trim() ? 0 : -1);
  const last = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const current = active < items.length ? active : -1;
  const pick = (i: number) => {
    const item = items[i];
    if (!item) return;
    last.current = i;
    setActive(-1);
    item.onPick();
  };
  const move = (step: number) => {
    if (!items.length) return;
    const from = current < 0 ? (step > 0 ? last.current - 1 : last.current + 1) : current;
    const next = (from + step + items.length) % items.length;
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (current >= 0) pick(current);
      else onSave();
    } else if (e.key === 'Backspace' && !query) {
      onBackspace();
    }
  };
  const groups: { name: string | undefined; entries: { item: PickerItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const group = groups.at(-1);
    if (group && group.name === item.group) group.entries.push({ item, index });
    else groups.push({ name: item.group, entries: [{ item, index }] });
  });
  const option = ({ item, index }: { item: PickerItem; index: number }) => (
    <div
      key={item.key}
      id={`${listId}-${index}`}
      role="option"
      aria-selected={item.selected === true}
      aria-label={item.label}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(index)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        pick(index);
      }}
      className={cn(MENU_ITEM, index === current && 'bg-fill-hover')}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{item.node}</span>
      {item.selected && <Check aria-hidden className="size-4 shrink-0 text-muted" />}
    </div>
  );
  return (
    <EditorShell
      label={label}
      commit={(m) => void onSave(m)}
      onOutside={() => {
        if (!onSave()) onCancel();
      }}
      onCancel={onCancel}
      initialFocus={input}
    >
      {chips.length > 0 && <div className="flex flex-wrap gap-1 px-1 pt-1">{chips}</div>}
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
        autoComplete="off"
        value={query}
        placeholder={CELL_TEXT.search}
        onChange={(e) => {
          onQuery(e.target.value);
          setActive(e.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded bg-transparent px-2 text-small text-fg placeholder:text-faint focus:outline-none"
      />
      {error && (
        <p role="alert" className="px-2 text-small text-danger">
          {error}
        </p>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className="max-h-64 overflow-y-auto border-t border-border pt-1"
      >
        {groups.map((g, i) =>
          g.name === undefined ? (
            g.entries.map(option)
          ) : (
            <div key={`${g.name}-${i}`} role="group" aria-label={g.name}>
              <div aria-hidden className="px-2 pb-0.5 pt-1.5 text-label text-muted">
                {g.name}
              </div>
              {g.entries.map(option)}
            </div>
          ),
        )}
      </div>
      {loading && (
        <div className="flex justify-center py-1.5">
          <Spinner label={CELL_TEXT.loading} />
        </div>
      )}
      {!loading && !items.length && (
        <p className="px-2 py-1.5 text-small text-muted">{CELL_TEXT.noMatches}</p>
      )}
    </EditorShell>
  );
}

/**
 * Select, Multi-select and Status: pick options by search; typing a new name creates one in the
 * next colour (Select and Multi-select, when `canCreateOptions`). Status lists options by group.
 */
export function OptionEditor({
  property,
  value,
  initialText,
  canCreateOptions = true,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const c = property.config as OptionConfig;
  const multiple = c.type === 'multi_select';
  const [picked, setPicked] = useState<Id[]>(() => toIds(value));
  const [created, setCreated] = useState<SelectOption[]>([]);
  const [query, setQuery] = useState(initialText ?? '');
  const [error, setError] = useState<string | null>(null);
  const options = [...c.options, ...created];

  const save = (ids: Id[], move?: CellMove, extra: SelectOption[] = []): boolean => {
    const used = [...created, ...extra].filter((o) => ids.includes(o.id));
    const config = { ...c, options: [...c.options, ...used] } as OptionConfig;
    const res = validateValue({ ...property, config }, multiple ? ids : (ids[0] ?? null));
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onCommit(res.value, commitDetails(value ?? null, res.value, move, used));
    return true;
  };
  const pick = (id: Id, extra: SelectOption[] = []) => {
    setError(null);
    setQuery('');
    if (multiple) setPicked((ids) => toggle(ids, id));
    else save([id], undefined, extra);
  };
  const q = query.trim();
  const create = () => {
    const problem = validateOptionName(q, options);
    if (problem) {
      setError(problem);
      return;
    }
    const option = newOption(q, options);
    setCreated((list) => [...list, option]);
    pick(option.id, [option]);
  };

  const groupIndex = (o: SelectOption) =>
    c.type === 'status' ? STATUS_GROUPS.indexOf((o as StatusOption).group) : 0;
  const items: PickerItem[] = options
    .filter((o) => matchesQuery(query, o.name))
    .sort((a, b) => groupIndex(a) - groupIndex(b))
    .map((o) => ({
      key: o.id,
      label: o.name,
      node: <OptionChip option={o} status={c.type === 'status'} />,
      group: c.type === 'status' ? STATUS_GROUP_LABELS[(o as StatusOption).group] : undefined,
      selected: picked.includes(o.id),
      onPick: () => pick(o.id),
    }));
  if (q && canCreateOptions && c.type !== 'status' && !findOptionByName(options, q)) {
    items.push({
      key: 'create',
      label: `${CELL_TEXT.create} ${q}`,
      node: (
        <>
          <span className="shrink-0 text-muted">{CELL_TEXT.create}</span>
          <OptionChip option={{ id: 'new', name: q, color: nextOptionColor(options) }} />
        </>
      ),
      onPick: create,
    });
  }
  const chips = picked.flatMap((id) => {
    const o = options.find((x) => x.id === id);
    if (!o) return [];
    return [
      <OptionChip key={id} option={o} status={c.type === 'status'}>
        <RemoveButton
          label={o.name}
          onClick={() => setPicked((ids) => ids.filter((x) => x !== id))}
        />
      </OptionChip>,
    ];
  });
  return (
    <ListPicker
      label={property.name}
      query={query}
      onQuery={(text) => {
        setQuery(text);
        setError(null);
      }}
      chips={chips}
      items={items}
      multiple={multiple}
      error={error}
      onSave={(move) => save(picked, move)}
      onCancel={() => onCancel()}
      onBackspace={() => setPicked((ids) => ids.slice(0, -1))}
    />
  );
}

/** Person: search the people list by name or email; "one person only" picks and saves. */
export function PersonEditor({
  property,
  value,
  ctx,
  initialText,
  people = [],
  onCommit,
  onCancel,
}: CellEditorProps) {
  const single = (property.config as ConfigOf<'person'>).single;
  const [picked, setPicked] = useState<Id[]>(() => toIds(value));
  const [query, setQuery] = useState(initialText ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = (ids: Id[], move?: CellMove): boolean => {
    const res = validateValue(property, ids);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onCommit(res.value, commitDetails(value ?? null, res.value, move));
    return true;
  };
  const pick = (id: Id) => {
    setError(null);
    setQuery('');
    if (single) save([id]);
    else setPicked((ids) => toggle(ids, id));
  };
  const items: PickerItem[] = people
    .filter((p) => !ctx.isRemovedUser?.(p.id) && matchesQuery(query, p.name, p.email))
    .map((p) => ({
      key: p.id,
      label: p.name,
      node: <PersonChip id={p.id} name={p.name} ctx={ctx} avatar={p.avatarUrl} />,
      selected: picked.includes(p.id),
      onPick: () => pick(p.id),
    }));
  const chips = picked.flatMap((id) => {
    const name = ctx.userName(id) ?? people.find((p) => p.id === id)?.name;
    if (name === undefined) return [];
    const remove = () => setPicked((ids) => ids.filter((x) => x !== id));
    return [
      <span key={id} className="inline-flex items-center gap-1 rounded bg-fill-hover px-1">
        <PersonChip id={id} name={name} ctx={ctx} />
        <RemoveButton label={name} onClick={remove} />
      </span>,
    ];
  });
  return (
    <ListPicker
      label={property.name}
      query={query}
      onQuery={(text) => {
        setQuery(text);
        setError(null);
      }}
      chips={chips}
      items={items}
      multiple={!single}
      error={error}
      onSave={(move) => save(picked, move)}
      onCancel={() => onCancel()}
      onBackspace={() => setPicked((ids) => ids.slice(0, -1))}
    />
  );
}

const SEARCH_DELAY_MS = 150;

/**
 * Relation: searches the target database's rows (`searchRows`) and can add one ("+ New row").
 * Rows the viewer can't open stay linked and are counted ("1 row you can't open").
 */
export function RelationEditor({
  property,
  value,
  ctx,
  initialText,
  searchRows,
  onCreateRow,
  hiddenLinks = 0,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const single = (property.config as ConfigOf<'relation'>).single;
  const [picked, setPicked] = useState<Id[]>(() => toIds(value));
  const [titles, setTitles] = useState<Record<Id, string>>({});
  const [query, setQuery] = useState(initialText ?? '');
  const [results, setResults] = useState<readonly RowChoice[]>([]);
  const [loading, setLoading] = useState(Boolean(searchRows));
  const [error, setError] = useState<string | null>(null);
  const search = useRef(searchRows);
  useEffect(() => {
    search.current = searchRows;
  });
  const first = useRef(true);
  useEffect(() => {
    const run = search.current;
    if (!run) return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(
      () => {
        run(query.trim()).then(
          (rows) => {
            if (!live) return;
            setResults(rows);
            setLoading(false);
          },
          () => {
            if (!live) return;
            setResults([]);
            setLoading(false);
          },
        );
      },
      first.current ? 0 : SEARCH_DELAY_MS,
    );
    first.current = false;
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const titleOf = (id: Id): string | undefined => titles[id] ?? ctx.rowTitle?.(id);
  const save = (ids: Id[], move?: CellMove): boolean => {
    const res = validateValue(property, ids);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onCommit(res.value, commitDetails(value ?? null, res.value, move));
    return true;
  };
  const pick = (row: RowChoice) => {
    setError(null);
    setQuery('');
    setTitles((t) => ({ ...t, [row.id]: row.title }));
    if (single) save([row.id]);
    else setPicked((ids) => toggle(ids, row.id));
  };
  const createRow = () => {
    if (!onCreateRow) return;
    setError(null);
    onCreateRow(query.trim()).then(pick, () => setError(CELL_TEXT.newRowFailed));
  };
  const items: PickerItem[] = results.map((row) => ({
    key: row.id,
    label: row.title || CELL_TEXT.untitled,
    node: <RowChip id={row.id} title={row.title} icon={row.icon} ctx={ctx} link={false} />,
    selected: picked.includes(row.id),
    onPick: () => pick(row),
  }));
  if (onCreateRow && !loading) {
    items.push({
      key: 'new-row',
      label: CELL_TEXT.newRow,
      node: <span className="text-muted">{CELL_TEXT.newRow}</span>,
      onPick: createRow,
    });
  }
  let hidden = hiddenLinks;
  const chips: ReactNode[] = [];
  for (const id of picked) {
    const title = titleOf(id);
    if (title === undefined) {
      hidden++;
      continue;
    }
    const remove = () => setPicked((ids) => ids.filter((x) => x !== id));
    chips.push(
      <RowChip key={id} id={id} title={title} ctx={ctx} link={false}>
        <RemoveButton label={title || CELL_TEXT.untitled} onClick={remove} />
      </RowChip>,
    );
  }
  if (hidden) chips.push(<HiddenRowsChip key="hidden" count={hidden} />);
  return (
    <ListPicker
      label={property.name}
      query={query}
      onQuery={(text) => {
        setQuery(text);
        setError(null);
      }}
      chips={chips}
      items={items}
      multiple={!single}
      error={error}
      loading={loading}
      onSave={(move) => save(picked, move)}
      onCancel={() => onCancel()}
      onBackspace={() =>
        setPicked((ids) => {
          const i = ids.findLastIndex((id) => titleOf(id) !== undefined);
          return i < 0 ? ids : ids.filter((_, j) => j !== i);
        })
      }
    />
  );
}
