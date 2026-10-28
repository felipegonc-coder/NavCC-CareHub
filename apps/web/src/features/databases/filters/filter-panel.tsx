/**
 * The Filter panel (Databases spec 3.2 and 3.4). Simple filters are chips under the toolbar, one
 * rule each: pick a property, then its condition and value. "Advanced filter" holds nested "All
 * of" and "Any of" groups. Every change goes to updateView({ filter }) at once; the shell saves it
 * for everyone or keeps it as "Changed for you only".
 */
import type { FilterGroup, Id, Property } from '@carehub/databases';
import { filterBarMode } from '@carehub/databases/filter';
import { Button, Input } from '@carehub/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PersonChoice } from '../cells';
import { AdvancedFilter } from './advanced-filter';
import {
  addRule,
  filterableProperties,
  findNode,
  hasRoom,
  newGroup,
  removeNode,
  startAdvanced,
  toAdvanced,
  toSaved,
} from './filter-model';
import { FILTER_TEXT } from './messages';
import { RuleFields, type Editing } from './rule-fields';
import { panelContext, type FilterPanelBaseProps } from './types';

export interface FilterPanelProps extends FilterPanelBaseProps {
  /** A chip was clicked: open on its rule. */
  ruleId?: Id | undefined;
  /** The "Advanced filter" chip was clicked. */
  advanced?: boolean | undefined;
  /** Called when there's nothing left to show (the chip's rule or the whole filter was deleted). */
  onClose?: (() => void) | undefined;
}

type Screen = { kind: 'pick' } | { kind: 'rule'; id: Id } | { kind: 'advanced' };

const NO_PEOPLE: readonly PersonChoice[] = [];

function firstScreen({ ruleId, advanced, view }: FilterPanelProps): Screen {
  if (ruleId) return { kind: 'rule', id: ruleId };
  return advanced || filterBarMode(view.filter) === 'advanced'
    ? { kind: 'advanced' }
    : { kind: 'pick' };
}

export function FilterPanel(props: FilterPanelProps) {
  const {
    meta,
    view,
    viewer,
    actions,
    propertyIds,
    people = NO_PEOPLE,
    rowTitles,
    onClose,
  } = props;
  const properties = useMemo(
    () => filterableProperties(meta.properties, propertyIds),
    [meta.properties, propertyIds],
  );
  const ctx = useMemo(
    () => panelContext({ meta, viewer, people, rowTitles }),
    [meta, viewer, people, rowTitles],
  );
  // The panel keeps its own copy so quick changes build on each other; a new saved filter (or a
  // rollback after the server refused) replaces it.
  const [saved, setSaved] = useState(view.filter);
  const [filter, setFilter] = useState(view.filter);
  if (view.filter !== saved) {
    setSaved(view.filter);
    setFilter(view.filter);
  }
  const [emptyRoot] = useState(() => newGroup());
  const [screen, setScreen] = useState<Screen>(() => firstScreen(props));

  const save = (next: FilterGroup | null) => {
    const value = toSaved(next);
    const before = view.filter;
    setFilter(value);
    actions.updateView({ filter: value }).catch(() => setFilter(before));
  };
  const root = filter ?? emptyRoot;
  const editing: Editing = { root, all: meta.properties, properties, ctx, people, save };
  const first = properties[0];

  if (screen.kind === 'advanced') {
    return (
      <AdvancedFilter
        editing={editing}
        onDelete={() => {
          save(null);
          if (onClose) onClose();
          else setScreen({ kind: 'pick' });
        }}
      />
    );
  }

  const found = screen.kind === 'rule' ? findNode(root, screen.id) : null;
  if (found?.node.kind === 'condition') {
    const rule = found.node;
    return (
      <div className="flex flex-col gap-3">
        <RuleFields rule={rule} editing={editing} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              save(toAdvanced(root));
              setScreen({ kind: 'advanced' });
            }}
          >
            {FILTER_TEXT.turnIntoAdvanced}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              save(removeNode(root, rule.id));
              if (onClose) onClose();
              else setScreen({ kind: 'pick' });
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            {FILTER_TEXT.deleteFilter}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PropertyPicker
      properties={properties}
      onPick={(prop) => {
        const { filter: next, id } = addRule(root, root.id, prop);
        save(next);
        setScreen({ kind: 'rule', id });
      }}
      onAdvanced={
        first
          ? () => {
              save(startAdvanced(filter, first));
              setScreen({ kind: 'advanced' });
            }
          : undefined
      }
      full={!hasRoom(filter)}
    />
  );
}

// ---------------------------------------------------------------- picking a property

function PropertyPicker({
  properties,
  onPick,
  onAdvanced,
  full,
}: {
  properties: readonly Property[];
  onPick(prop: Property): void;
  onAdvanced: (() => void) | undefined;
  full: boolean;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLocaleLowerCase();
  const shown = query
    ? properties.filter((p) => p.name.toLocaleLowerCase().includes(query))
    : properties;
  if (!properties.length)
    return <p className="text-small text-muted">{FILTER_TEXT.noProperties}</p>;
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={FILTER_TEXT.filterBy}
        placeholder={FILTER_TEXT.filterBy}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {full && <p className="text-label text-muted">{FILTER_TEXT.maxConditions}</p>}
      {shown.length ? (
        <ul aria-label={FILTER_TEXT.filterBy} className="flex max-h-64 flex-col overflow-y-auto">
          {shown.map((prop) => (
            <li key={prop.id}>
              <button
                type="button"
                disabled={full}
                onClick={() => onPick(prop)}
                className="flex w-full items-center rounded px-2 py-1 text-left text-small text-fg hover:bg-fill-hover disabled:cursor-not-allowed disabled:text-faint"
              >
                <span className="truncate">{prop.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted">{FILTER_TEXT.noMatches}</p>
      )}
      {onAdvanced && (
        <Button variant="ghost" size="sm" onClick={onAdvanced} className="self-start">
          <Plus aria-hidden className="size-4" />
          {FILTER_TEXT.addAdvancedFilter}
        </Button>
      )}
    </div>
  );
}
