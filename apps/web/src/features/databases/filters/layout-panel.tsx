/**
 * The Layout panel's view settings (Databases spec 2, 3.2, 3.3 and 3.13), from the toolbar's "…" →
 * Layout: where rows open, the load limit, page icons, wrapping, how the view tabs show, sub-items
 * and the layout's own options. Each change is one updateView patch, saved for everyone, so only
 * people who can edit the view make them.
 */
import type { CardPreview, DatabaseMeta, Id, Property, View } from '@carehub/databases';
import { Switch } from '@carehub/ui';
import { useId, useMemo, useState } from 'react';
import type { ViewChange } from '../api';
import { NativeSelect } from '../cells/controls';
import type { ViewActions } from '../contract';
import { withTableOptions } from '../table/view-settings';
import {
  boardOptions,
  calendarOptions,
  cardPreviews,
  dateProperties,
  galleryOptions,
  layoutSettings,
  LOAD_LIMITS,
  OPEN_MODES,
  previewKey,
  SUB_ITEM_MODES,
  timelineOptions,
} from './layout-model';
import {
  CARD_PREVIEW_LABELS,
  CARD_SIZE_LABELS,
  LAYOUT_TEXT,
  OPEN_MODE_LABELS,
  SUB_ITEMS_LABELS,
  TABS_AS_LABELS,
} from './layout-text';

export interface LayoutPanelProps {
  meta: DatabaseMeta;
  view: View;
  actions: Pick<ViewActions, 'updateView'>;
  /** Changes are saved for everyone (Can edit, Lock structure off, online); otherwise read only. */
  canEditViews: boolean;
  /** The properties the viewer can see (the query answer's propertyIds); all when absent. */
  propertyIds?: readonly Id[] | undefined;
}

type Choices<K extends string> = readonly (readonly [K, string])[];

const CARD_SIZES = ['s', 'm', 'l'] as const;
const TABS_AS = ['tabs', 'dropdown'] as const;
const labelled = <K extends string>(keys: readonly K[], labels: Readonly<Record<K, string>>) =>
  keys.map((k) => [k, labels[k]] as const);

export function LayoutPanel({ meta, view, actions, canEditViews, propertyIds }: LayoutPanelProps) {
  // The panel keeps its own copy so quick changes build on each other; a newer saved view (or a
  // rollback after the server refused) replaces it.
  const [saved, setSaved] = useState(view);
  const [current, setCurrent] = useState(view);
  if (view !== saved) {
    setSaved(view);
    setCurrent(view);
  }
  const properties = useMemo(() => {
    const seen = propertyIds ? new Set(propertyIds) : null;
    return meta.properties.filter((p) => seen === null || seen.has(p.id));
  }, [meta.properties, propertyIds]);

  const save = (patch: ViewChange) => {
    const before = view;
    setCurrent({ ...current, ...patch });
    actions.updateView(patch).catch(() => setCurrent(before));
  };

  const has = layoutSettings(current.layout, meta);
  const general = [has.openPagesIn, has.loadLimit, has.showPageIcon, has.wrapText, has.tabsAs];
  if (!general.some(Boolean) && !has.subItems && has.options === null) {
    return <p className="text-small text-muted">{LAYOUT_TEXT.noSettings}</p>;
  }
  const subItems = current.subItems ?? 'nested';
  return (
    <div className="flex flex-col gap-3">
      {!canEditViews && <p className="text-label text-muted">{LAYOUT_TEXT.readOnly}</p>}
      <fieldset disabled={!canEditViews} className="flex min-w-0 flex-col gap-2">
        {has.openPagesIn && (
          <Choice
            label={LAYOUT_TEXT.openPagesIn}
            value={current.openPagesIn}
            choices={labelled(OPEN_MODES, OPEN_MODE_LABELS)}
            onChange={(openPagesIn) => save({ openPagesIn })}
          />
        )}
        {has.loadLimit && (
          <Choice
            label={LAYOUT_TEXT.loadLimit}
            value={String(current.loadLimit)}
            choices={LOAD_LIMITS.map(
              (n) =>
                [
                  String(n),
                  current.layout === 'board' ? LAYOUT_TEXT.cards(n) : LAYOUT_TEXT.rows(n),
                ] as const,
            )}
            onChange={(key) => {
              const loadLimit = LOAD_LIMITS.find((n) => String(n) === key);
              if (loadLimit) save({ loadLimit });
            }}
          />
        )}
        {has.showPageIcon && (
          <Toggle
            label={LAYOUT_TEXT.showPageIcon}
            checked={current.showPageIcon}
            onChange={(showPageIcon) => save({ showPageIcon })}
          />
        )}
        {has.wrapText && (
          <Toggle
            label={LAYOUT_TEXT.wrapText}
            checked={current.wrapText === true}
            onChange={(wrapText) => save({ wrapText })}
          />
        )}
        {has.tabsAs && (
          <Choice
            label={LAYOUT_TEXT.tabsAs}
            value={current.tabsAs ?? 'tabs'}
            choices={labelled(TABS_AS, TABS_AS_LABELS)}
            onChange={(tabsAs) => save({ tabsAs })}
          />
        )}
        {has.subItems && (
          <>
            <Choice
              label={LAYOUT_TEXT.subItems}
              value={subItems}
              choices={labelled(SUB_ITEM_MODES, SUB_ITEMS_LABELS)}
              onChange={(mode) => save({ subItems: mode })}
            />
            {subItems === 'nested' && (
              <Toggle
                label={LAYOUT_TEXT.filterSubItems}
                checked={current.filterSubItems === true}
                onChange={(filterSubItems) => save({ filterSubItems })}
              />
            )}
          </>
        )}
        <LayoutOptions
          view={current}
          meta={meta}
          properties={properties}
          kind={has.options}
          save={save}
        />
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------- the layout's own options

function LayoutOptions({
  view,
  meta,
  properties,
  kind,
  save,
}: {
  view: View;
  meta: DatabaseMeta;
  properties: readonly Property[];
  kind: ReturnType<typeof layoutSettings>['options'];
  save(patch: ViewChange): void;
}) {
  if (kind === 'table') {
    const table = withTableOptions(view, {});
    return (
      <>
        <Toggle
          label={LAYOUT_TEXT.wrapCells}
          checked={table.wrapCells}
          onChange={(wrapCells) => save({ table: { ...table, wrapCells } })}
        />
        <Toggle
          label={LAYOUT_TEXT.verticalLines}
          checked={table.showVerticalLines}
          onChange={(showVerticalLines) => save({ table: { ...table, showVerticalLines } })}
        />
      </>
    );
  }
  if (kind === 'board' || kind === 'gallery') {
    const board = kind === 'board' ? boardOptions(view, meta.properties) : null;
    const cards = board ?? galleryOptions(view, meta.properties);
    const change = (patch: Partial<typeof cards>) =>
      save(board ? { board: { ...board, ...patch } } : { gallery: { ...cards, ...patch } });
    const previews = cardPreviews(properties);
    return (
      <>
        <Choice
          label={LAYOUT_TEXT.cardPreview}
          value={previewKey(cards.cardPreview)}
          choices={previews.map((p) => [previewKey(p), previewLabel(p, properties)] as const)}
          onChange={(key) => {
            const cardPreview = previews.find((p) => previewKey(p) === key);
            if (cardPreview) change({ cardPreview });
          }}
        />
        <Choice
          label={LAYOUT_TEXT.cardSize}
          value={cards.cardSize}
          choices={labelled(CARD_SIZES, CARD_SIZE_LABELS)}
          onChange={(cardSize) => change({ cardSize })}
        />
        <Toggle
          label={LAYOUT_TEXT.fitImage}
          checked={cards.fitImage}
          onChange={(fitImage) => change({ fitImage })}
        />
        {board && (
          <Toggle
            label={LAYOUT_TEXT.colorColumns}
            checked={board.colorColumns}
            onChange={(colorColumns) => save({ board: { ...board, colorColumns } })}
          />
        )}
      </>
    );
  }
  if (kind === 'calendar') {
    const calendar = calendarOptions(view, meta.properties);
    return (
      <>
        <ShowBy
          value={calendar.showBy}
          dates={dateProperties(properties, 'calendar')}
          onChange={(showBy) => save({ calendar: { ...calendar, showBy } })}
        />
        <Toggle
          label={LAYOUT_TEXT.showWeekends}
          checked={calendar.showWeekends}
          onChange={(showWeekends) => save({ calendar: { ...calendar, showWeekends } })}
        />
      </>
    );
  }
  if (kind === 'timeline') {
    const timeline = timelineOptions(view, meta.properties);
    const change = (patch: Partial<typeof timeline>) =>
      save({ timeline: { ...timeline, ...patch } });
    const dates = dateProperties(properties, 'timeline');
    const ends = dates.filter((p) => p.id !== timeline.showBy);
    return (
      <>
        <ShowBy value={timeline.showBy} dates={dates} onChange={(showBy) => change({ showBy })} />
        <Choice
          label={LAYOUT_TEXT.endBy}
          value={timeline.endBy ?? ''}
          choices={[['', LAYOUT_TEXT.sameProperty], ...ends.map((p) => [p.id, p.name] as const)]}
          onChange={(key) => change({ endBy: key === '' ? null : key })}
        />
        <Toggle
          label={LAYOUT_TEXT.showTable}
          checked={timeline.showTable}
          onChange={(showTable) => change({ showTable })}
        />
        <Toggle
          label={LAYOUT_TEXT.showWeekends}
          checked={timeline.showWeekends !== false}
          onChange={(showWeekends) => change({ showWeekends })}
        />
        {meta.dependencies && (
          <Toggle
            label={LAYOUT_TEXT.showDependencies}
            checked={timeline.showDependencies !== false}
            onChange={(showDependencies) => change({ showDependencies })}
          />
        )}
      </>
    );
  }
  return null;
}

function previewLabel(preview: CardPreview, properties: readonly Property[]): string {
  if (preview.kind !== 'files') return CARD_PREVIEW_LABELS[preview.kind];
  return properties.find((p) => p.id === preview.propertyId)?.name ?? LAYOUT_TEXT.deletedProperty;
}

/** A calendar's or timeline's date property; "No date property" while it has none. */
function ShowBy({
  value,
  dates,
  onChange,
}: {
  value: Id | null;
  dates: readonly Property[];
  onChange(id: Id): void;
}) {
  const known = dates.some((p) => p.id === value);
  const choices: Choices<string> = [
    ...(known ? [] : [['', LAYOUT_TEXT.noDate] as const]),
    ...dates.map((p) => [p.id, p.name] as const),
  ];
  return (
    <Choice
      label={LAYOUT_TEXT.showBy}
      value={known && value !== null ? value : ''}
      choices={choices}
      onChange={(key) => {
        if (key !== '') onChange(key);
      }}
    />
  );
}

// ---------------------------------------------------------------- controls

/** A labelled native select over fixed choices; picking the one shown sends nothing. */
function Choice<K extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: K;
  choices: Choices<K>;
  onChange(value: K): void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <span id={id} className="w-32 shrink-0 text-small text-fg">
        {label}
      </span>
      <NativeSelect
        aria-labelledby={id}
        className="min-w-0 flex-1"
        value={value}
        onChange={(e) => {
          const picked = choices.find(([k]) => k === e.target.value);
          if (picked && picked[0] !== value) onChange(picked[0]);
        }}
      >
        {choices.map(([k, text]) => (
          <option key={k} value={k}>
            {text}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <span id={id} className="text-small text-fg">
        {label}
      </span>
      <Switch aria-labelledby={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
