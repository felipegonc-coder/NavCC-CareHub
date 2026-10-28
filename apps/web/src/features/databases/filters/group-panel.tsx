/**
 * The Group panel (Databases spec 3.2 and 3.3): groups a view's rows by a property, with that
 * property's own setting (dates by Relative, Day, Week, Month or Year; status by option or status
 * group; text by exact value or first letter; numbers by exact value or ranges of a chosen size),
 * the groups' order (option order, A→Z, Z→A, or by hand: drag a group by its handle or move it
 * with the arrow keys), Hide empty groups, and each group shown or hidden. Boards are always
 * grouped, and people who can edit the view can split a board into sub-groups by a second
 * property. Every change is one updateView({ grouping }) or ({ subGrouping }): saved for everyone,
 * or "Changed for you only" for people who can't edit the view.
 */
import type {
  DatabaseMeta,
  EvalContext,
  Grouping,
  Id,
  Property,
  View,
  Viewer,
} from '@carehub/databases';
import { Button, cn, IconButton, Input, Switch } from '@carehub/ui';
import { Eye, EyeOff, GripVertical } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { NativeSelect } from '../cells/controls';
import type { ViewActions } from '../contract';
import {
  groupableProperties,
  groupMode,
  layoutGroups,
  listGroups,
  readRange,
  sortChoices,
  sortInUse,
  withGroupHidden,
  withGroupMoved,
  withHiddenKeys,
  withMode,
  type AnsweredGroup,
  type GroupChoice,
} from './group-model';
import { DATE_BUCKET_LABELS, DATE_BUCKETS, GROUP_SORT_LABELS, GROUP_TEXT } from './group-text';
import { FILTER_TEXT } from './messages';
import { useReorder } from './reorder';
import { panelContext } from './types';

type NumberRange = NonNullable<Grouping['numberRange']>;

export interface GroupPanelProps {
  meta: DatabaseMeta;
  view: View;
  viewer: Viewer;
  actions: Pick<ViewActions, 'updateView'>;
  /** Changes are saved for everyone; otherwise grouping is "Changed for you only". */
  canEditViews: boolean;
  /** The properties the viewer can see (the query answer's propertyIds); all when absent. */
  propertyIds?: readonly Id[] | undefined;
  /** Titles of related rows (the query answer's rowTitles), for relation groups. */
  rowTitles?: Readonly<Record<Id, string>> | undefined;
  /** The query answer's groups and board lanes, which name every group; else the package's. */
  groups?: readonly AnsweredGroup[] | null | undefined;
  lanes?: readonly AnsweredGroup[] | null | undefined;
}

/** Where number ranges start when chosen. */
const FIRST_RANGE: NumberRange = { start: 0, end: 100, step: 10 };

export function GroupPanel(props: GroupPanelProps) {
  const { meta, view, viewer, actions, canEditViews, propertyIds, rowTitles } = props;
  // The panel keeps its own copy so quick changes build on each other; a newer saved view (or a
  // rollback after the server refused) replaces it.
  const [saved, setSaved] = useState({ grouping: view.grouping, subGrouping: view.subGrouping });
  const [grouping, setGrouping] = useState(view.grouping);
  const [subGrouping, setSubGrouping] = useState(view.subGrouping);
  if (view.grouping !== saved.grouping || view.subGrouping !== saved.subGrouping) {
    setSaved({ grouping: view.grouping, subGrouping: view.subGrouping });
    setGrouping(view.grouping);
    setSubGrouping(view.subGrouping);
  }
  const properties = useMemo(
    () => groupableProperties(meta.properties, propertyIds),
    [meta.properties, propertyIds],
  );
  const ctx = useMemo(() => panelContext({ meta, viewer, rowTitles }), [meta, viewer, rowTitles]);

  if (!layoutGroups(view.layout)) {
    return <p className="text-small text-muted">{GROUP_TEXT.notGrouped}</p>;
  }
  if (properties.length === 0 && grouping === null) {
    return <p className="text-small text-muted">{GROUP_TEXT.noProperties}</p>;
  }
  const board = view.layout === 'board';
  const withLanes = board && canEditViews;

  const save = (next: Grouping | null) => {
    const before = view;
    // A board isn't split twice by the same property.
    const clash = withLanes && next !== null && subGrouping?.propertyId === next.propertyId;
    setGrouping(next);
    if (clash) setSubGrouping(null);
    actions
      .updateView(clash ? { grouping: next, subGrouping: null } : { grouping: next })
      .catch(() => {
        setGrouping(before.grouping);
        setSubGrouping(before.subGrouping);
      });
  };
  const saveLanes = (next: Grouping | null) => {
    const before = view.subGrouping;
    setSubGrouping(next);
    actions.updateView({ subGrouping: next }).catch(() => setSubGrouping(before));
  };

  return (
    <div className="flex flex-col gap-4">
      <GroupingEditor
        label={GROUP_TEXT.groupBy}
        listLabel={GROUP_TEXT.groups}
        grouping={grouping}
        properties={properties}
        canRemove={!board}
        ctx={ctx}
        answer={props.groups}
        onChange={save}
      />
      {withLanes && grouping && (
        <GroupingEditor
          label={GROUP_TEXT.subGroupBy}
          listLabel={GROUP_TEXT.lanes}
          grouping={subGrouping}
          properties={properties.filter((p) => p.id !== grouping.propertyId)}
          canRemove
          ctx={ctx}
          answer={props.lanes}
          onChange={saveLanes}
        />
      )}
    </div>
  );
}

interface EditorProps {
  label: string;
  listLabel: string;
  grouping: Grouping | null;
  /** The properties it can pick. */
  properties: readonly Property[];
  /** Tables, lists, galleries and timelines can be ungrouped ("None"); boards can't. */
  canRemove: boolean;
  ctx: EvalContext;
  answer: readonly AnsweredGroup[] | null | undefined;
  onChange(next: Grouping | null): void;
}

/** "Group by" (or "Sub-group by") and the chosen property's settings and groups. */
function GroupingEditor(props: EditorProps) {
  const { label, grouping, properties, canRemove, ctx, onChange } = props;
  const property = grouping ? ctx.properties.find((p) => p.id === grouping.propertyId) : undefined;
  const listed = grouping !== null && properties.some((p) => p.id === grouping.propertyId);
  return (
    <section className="flex flex-col gap-2">
      <Choice
        label={label}
        value={grouping?.propertyId ?? ''}
        choices={[
          ...(canRemove || grouping === null ? [['', GROUP_TEXT.none] as const] : []),
          ...(grouping && !listed
            ? [[grouping.propertyId, property?.name ?? FILTER_TEXT.deletedProperty] as const]
            : []),
          ...properties.map((p) => [p.id, p.name] as const),
        ]}
        onChange={(id) => onChange(id ? { propertyId: id } : null)}
      />
      {grouping && property && (
        <GroupSettings
          key={grouping.propertyId}
          {...props}
          grouping={grouping}
          property={property}
        />
      )}
    </section>
  );
}

function GroupSettings({
  listLabel,
  grouping,
  property,
  ctx,
  answer,
  onChange,
}: EditorProps & { grouping: Grouping; property: Property }) {
  const id = useId();
  const mode = groupMode(property);
  const groups = useMemo(() => listGroups(grouping, ctx, answer), [grouping, ctx, answer]);
  return (
    <>
      {mode === 'date' && (
        <Choice
          label={GROUP_TEXT.dateBy}
          value={grouping.dateBucket ?? 'relative'}
          choices={DATE_BUCKETS.map((b) => [b, DATE_BUCKET_LABELS[b]] as const)}
          onChange={(dateBucket) => onChange(withMode(grouping, { dateBucket }))}
        />
      )}
      {mode === 'status' && (
        <Choice
          label={GROUP_TEXT.statusBy}
          value={grouping.statusBy ?? 'option'}
          choices={[
            ['option', GROUP_TEXT.option],
            ['group', GROUP_TEXT.statusGroup],
          ]}
          onChange={(statusBy) => onChange(withMode(grouping, { statusBy }))}
        />
      )}
      {mode === 'text' && (
        <Choice
          label={GROUP_TEXT.textBy}
          value={grouping.textBy ?? 'exact'}
          choices={[
            ['exact', GROUP_TEXT.exactValue],
            ['alphabetical', GROUP_TEXT.firstLetter],
          ]}
          onChange={(textBy) => onChange(withMode(grouping, { textBy }))}
        />
      )}
      {mode === 'number' && (
        <>
          <Choice
            label={GROUP_TEXT.numberBy}
            value={grouping.numberRange ? 'ranges' : 'exact'}
            choices={[
              ['exact', GROUP_TEXT.exactValue],
              ['ranges', GROUP_TEXT.ranges],
            ]}
            onChange={(by) =>
              onChange(withMode(grouping, { numberRange: by === 'ranges' ? FIRST_RANGE : null }))
            }
          />
          {grouping.numberRange && (
            <RangeSetting
              range={grouping.numberRange}
              onChange={(numberRange) => onChange(withMode(grouping, { numberRange }))}
            />
          )}
        </>
      )}
      <Choice
        label={GROUP_TEXT.sortGroups}
        value={sortInUse(grouping, property)}
        choices={sortChoices(property).map((s) => [s, GROUP_SORT_LABELS[s]] as const)}
        onChange={(sort) => onChange({ ...grouping, sort })}
      />
      <div className="flex items-center gap-2">
        <Switch
          aria-labelledby={`${id}-empty`}
          checked={grouping.hideEmpty === true}
          onCheckedChange={(on) => onChange({ ...grouping, hideEmpty: on })}
        />
        <span id={`${id}-empty`} className="text-small text-fg">
          {GROUP_TEXT.hideEmpty}
        </span>
      </div>
      {groups.length > 0 && (
        <GroupList label={listLabel} grouping={grouping} groups={groups} onChange={onChange} />
      )}
    </>
  );
}

/** A labelled native select over a fixed set of values. */
function Choice<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly (readonly [T, string])[];
  onChange(value: T): void;
}) {
  const id = useId();
  return (
    <Row id={id} label={label}>
      <NativeSelect
        aria-labelledby={id}
        className="min-w-0 flex-1"
        value={value}
        onChange={(e) => {
          const picked = choices.find(([v]) => v === e.target.value);
          if (picked) onChange(picked[0]);
        }}
      >
        {choices.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </NativeSelect>
    </Row>
  );
}

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span id={id} className="w-28 shrink-0 text-small text-fg">
        {label}
      </span>
      {children}
    </div>
  );
}

/** From, To and Size of number ranges, saved on Enter or leaving a field once all three fit. */
function RangeSetting({
  range,
  onChange,
}: {
  range: NumberRange;
  onChange(range: NumberRange): void;
}) {
  const id = useId();
  const [texts, setTexts] = useState({
    from: String(range.start),
    to: String(range.end),
    size: String(range.step),
  });
  const [error, setError] = useState('');
  const commit = () => {
    const read = readRange(texts.from, texts.to, texts.size);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    setError('');
    const next = read.range;
    if (next.start !== range.start || next.end !== range.end || next.step !== range.step) {
      onChange(next);
    }
  };
  const field = (key: keyof typeof texts, label: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span id={`${id}-${key}`} className="text-label text-muted">
        {label}
      </span>
      <Input
        aria-labelledby={`${id}-${key}`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        inputMode="decimal"
        value={texts[key]}
        onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit();
        }}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {field('from', GROUP_TEXT.from)}
        {field('to', GROUP_TEXT.to)}
        {field('size', GROUP_TEXT.size)}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The groups (or a board's sub-groups): drag or arrow keys to order them by hand, eye to hide. */
function GroupList({
  label,
  grouping,
  groups,
  onChange,
}: {
  label: string;
  grouping: Grouping;
  groups: GroupChoice[];
  onChange(next: Grouping): void;
}) {
  const id = useId();
  const [said, setSaid] = useState('');
  const keys = groups.map((g) => g.key);
  const move = (from: number, to: number) => {
    const group = groups[from];
    if (!group || to === from || to < 0 || to >= groups.length) return;
    onChange(withGroupMoved(grouping, keys, from, to));
    setSaid(GROUP_TEXT.moved(group.label, to + 1, groups.length));
  };
  const reorder = useReorder(groups.length, move);
  const { drag } = reorder;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-label font-medium text-muted">
          {label}
        </h3>
        <div className="flex gap-1">
          {groups.some((g) => g.hidden) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(withHiddenKeys(grouping, keys, false))}
            >
              {GROUP_TEXT.showAll}
            </Button>
          )}
          {groups.some((g) => !g.hidden) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(withHiddenKeys(grouping, keys, true))}
            >
              {GROUP_TEXT.hideAll}
            </Button>
          )}
        </div>
      </div>
      <ul aria-labelledby={id} className="flex max-h-64 flex-col overflow-y-auto">
        {groups.map((group, index) => (
          <li
            key={group.key}
            ref={reorder.rowRef(index)}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded px-1 py-0.5',
              drag?.from === index && 'bg-fill',
              drag && drag.to === index && drag.from !== index && 'ring-2 ring-ring',
            )}
          >
            <IconButton
              {...reorder.handle(index)}
              label={GROUP_TEXT.move(group.label)}
              size="sm"
              className="cursor-grab touch-none"
            >
              <GripVertical aria-hidden className="size-4" />
            </IconButton>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-small',
                group.hidden ? 'text-muted' : 'text-fg',
              )}
            >
              {group.label}
            </span>
            <IconButton
              label={group.hidden ? GROUP_TEXT.show(group.label) : GROUP_TEXT.hide(group.label)}
              size="sm"
              onClick={() => onChange(withGroupHidden(grouping, group.key, !group.hidden))}
            >
              {group.hidden ? (
                <EyeOff aria-hidden className="size-4" />
              ) : (
                <Eye aria-hidden className="size-4" />
              )}
            </IconButton>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
