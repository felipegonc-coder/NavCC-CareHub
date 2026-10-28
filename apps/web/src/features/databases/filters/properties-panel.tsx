/**
 * The Properties panel (Databases spec 3.2 and 3.3): which properties this view shows, and in what
 * order. Drag a shown property by its handle or move it with the arrow keys; hide or show each one,
 * or all of them; in a table, set a column's width and wrap. Name stays first (tables always show
 * it). Every change is one updateView({ properties }) or ({ showTitle }), saved for everyone, so
 * only people who can edit the view make them. Properties → Deleted lists the deleted properties
 * with Restore.
 */
import type {
  DatabaseMeta,
  Id,
  Property,
  View,
  ViewPropertySetting,
  Viewer,
} from '@carehub/databases';
import { Button, cn, IconButton, Input, Switch } from '@carehub/ui';
import { ArrowLeft, Eye, EyeOff, GripVertical, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  canChangeProperties,
  DeletedProperties,
  PropertyTypeIcon,
  usePropertyActions,
} from '../cells';
import type { ViewActions } from '../contract';
import { useDatabase } from '../hooks';
import { errorText } from '../shell/states';
import { COLUMN_WIDTH, NAME_WIDTH } from '../table/columns';
import {
  listProperties,
  matching,
  readWidth,
  withAllShown,
  withColumn,
  withMoved,
  withShown,
} from './properties-model';
import { PROPERTIES_TEXT } from './properties-text';
import { useReorder } from './reorder';

export interface PropertiesPanelProps {
  meta: DatabaseMeta;
  view: View;
  viewer: Viewer;
  actions: Pick<ViewActions, 'updateView'>;
  /** Changes are saved for everyone (Can edit, Lock structure off, online); otherwise read only. */
  canEditViews: boolean;
  /** The properties the viewer can see (the query answer's propertyIds); all when absent. */
  propertyIds?: readonly Id[] | undefined;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const [screen, setScreen] = useState<'list' | 'deleted' | 'back'>('list');
  const canRestore = props.canEditViews && canChangeProperties(props.meta);
  if (screen === 'deleted' && canRestore) {
    return <DeletedScreen {...props} onBack={() => setScreen('back')} />;
  }
  return (
    <PropertyLists
      {...props}
      onDeleted={canRestore ? () => setScreen('deleted') : undefined}
      focusDeleted={screen === 'back'}
    />
  );
}

interface ListsProps extends PropertiesPanelProps {
  onDeleted: (() => void) | undefined;
  /** Back from Deleted: focus goes to the Deleted button. */
  focusDeleted: boolean;
}

function PropertyLists(props: ListsProps) {
  const { meta, view, actions, canEditViews: canEdit, propertyIds, onDeleted } = props;
  const ids = useId();
  const deletedButton = useRef<HTMLButtonElement | null>(null);
  const focusDeleted = useRef(props.focusDeleted);
  useEffect(() => {
    if (focusDeleted.current) deletedButton.current?.focus();
  }, []);

  // The panel keeps its own copy so quick changes build on each other; a newer saved view (or a
  // rollback after the server refused) replaces it.
  const [saved, setSaved] = useState(view.properties);
  const [settings, setSettings] = useState(view.properties);
  if (view.properties !== saved) {
    setSaved(view.properties);
    setSettings(view.properties);
  }
  const [savedTitle, setSavedTitle] = useState(view.showTitle);
  const [showTitle, setShowTitle] = useState(view.showTitle !== false);
  if (view.showTitle !== savedTitle) {
    setSavedTitle(view.showTitle);
    setShowTitle(view.showTitle !== false);
  }
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Id | null>(null);
  const [said, setSaid] = useState('');
  const list = useMemo(
    () => listProperties(meta.properties, settings, propertyIds),
    [meta.properties, settings, propertyIds],
  );

  const save = (next: ViewPropertySetting[]) => {
    const before = view.properties;
    setSettings(next);
    actions.updateView({ properties: next }).catch(() => setSettings(before));
  };
  const saveTitle = (on: boolean) => {
    const before = view.showTitle !== false;
    setShowTitle(on);
    actions.updateView({ showTitle: on }).catch(() => setShowTitle(before));
  };
  const move = (from: number, to: number) => {
    const property = list.shown[from];
    if (!property || to === from || to < 0 || to >= list.shown.length) return;
    save(withMoved(list, settings, from, to));
    setSaid(PROPERTIES_TEXT.moved(property.name, to + 1, list.shown.length));
  };
  const reorder = useReorder(list.shown.length, move);
  const { drag } = reorder;

  const table = view.layout === 'table';
  const searching = q.trim() !== '';
  const title = list.title && matching([list.title], q).length > 0 ? list.title : undefined;
  const titleShown = table || showTitle;
  const shown = matching(list.shown, q);
  const hidden = matching(list.hidden, q);
  const settingOf = (id: Id) => settings.find((s) => s.propertyId === id);
  const wrapDefault = view.table?.wrapCells ?? false;

  const name = (property: Property, extra?: ReactNode) => (
    <>
      <PropertyTypeIcon type={property.config.type} />
      <span className="min-w-0 flex-1 truncate text-small text-fg">{property.name}</span>
      {extra}
    </>
  );
  const columnButton = (property: Property) =>
    table &&
    canEdit && (
      <IconButton
        label={PROPERTIES_TEXT.column(property.name)}
        size="sm"
        aria-expanded={open === property.id}
        onClick={() => setOpen(open === property.id ? null : property.id)}
      >
        <SlidersHorizontal aria-hidden className="size-4" />
      </IconButton>
    );
  const columnSettings = (property: Property) =>
    table &&
    open === property.id && (
      <ColumnSettings
        property={property}
        setting={settingOf(property.id)}
        wrapDefault={wrapDefault}
        onChange={(change) => save(withColumn(settings, property.id, change))}
      />
    );
  const eye = (property: Property, show: boolean, onClick: () => void) =>
    canEdit && (
      <IconButton
        label={show ? PROPERTIES_TEXT.show(property.name) : PROPERTIES_TEXT.hide(property.name)}
        size="sm"
        onClick={onClick}
      >
        {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </IconButton>
    );

  const shownCount = shown.length + (title && titleShown ? 1 : 0);
  const hiddenCount = hidden.length + (title && !titleShown ? 1 : 0);
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={PROPERTIES_TEXT.search}
        placeholder={PROPERTIES_TEXT.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!canEdit && <p className="text-label text-muted">{PROPERTIES_TEXT.readOnly}</p>}
      {shownCount > 0 && (
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 id={`${ids}-shown`} className="text-label font-medium text-muted">
              {PROPERTIES_TEXT.shown}
            </h3>
            {canEdit && list.shown.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => save(withAllShown(list, settings, false))}
              >
                {PROPERTIES_TEXT.hideAll}
              </Button>
            )}
          </div>
          <ul aria-labelledby={`${ids}-shown`} className="flex max-h-80 flex-col overflow-y-auto">
            {title && titleShown && (
              <li className="flex flex-col">
                <div className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                  {name(
                    title,
                    table ? (
                      <span className="text-label text-muted">{PROPERTIES_TEXT.alwaysShown}</span>
                    ) : (
                      eye(title, false, () => saveTitle(false))
                    ),
                  )}
                  {columnButton(title)}
                </div>
                {columnSettings(title)}
              </li>
            )}
            {shown.map((property, index) => (
              <li
                key={property.id}
                ref={searching ? undefined : reorder.rowRef(index)}
                className={cn(
                  'flex flex-col rounded',
                  drag?.from === index && 'bg-fill',
                  drag && drag.to === index && drag.from !== index && 'ring-2 ring-ring',
                )}
              >
                <div className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                  {canEdit && !searching && (
                    <IconButton
                      {...reorder.handle(index)}
                      label={PROPERTIES_TEXT.move(property.name)}
                      size="sm"
                      className="cursor-grab touch-none"
                    >
                      <GripVertical aria-hidden className="size-4" />
                    </IconButton>
                  )}
                  {name(property)}
                  {columnButton(property)}
                  {eye(property, false, () => save(withShown(list, settings, property.id, false)))}
                </div>
                {columnSettings(property)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {hiddenCount > 0 && (
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 id={`${ids}-hidden`} className="text-label font-medium text-muted">
              {PROPERTIES_TEXT.hidden}
            </h3>
            {canEdit && list.hidden.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => save(withAllShown(list, settings, true))}
              >
                {PROPERTIES_TEXT.showAll}
              </Button>
            )}
          </div>
          <ul aria-labelledby={`${ids}-hidden`} className="flex max-h-80 flex-col overflow-y-auto">
            {title && !titleShown && (
              <li className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                {name(
                  title,
                  eye(title, true, () => saveTitle(true)),
                )}
              </li>
            )}
            {hidden.map((property) => (
              <li key={property.id} className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                {name(
                  property,
                  eye(property, true, () => save(withShown(list, settings, property.id, true))),
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {searching && shownCount + hiddenCount === 0 && (
        <p className="text-small text-muted">{PROPERTIES_TEXT.noMatches}</p>
      )}
      {onDeleted && (
        <Button
          ref={deletedButton}
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onDeleted}
        >
          <Trash2 aria-hidden className="size-4" />
          {PROPERTIES_TEXT.deleted}
        </Button>
      )}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- a table column's width and wrap

function ColumnSettings({
  property,
  setting,
  wrapDefault,
  onChange,
}: {
  property: Property;
  setting: ViewPropertySetting | undefined;
  wrapDefault: boolean;
  onChange(change: { width?: number | undefined; wrap?: boolean }): void;
}) {
  const id = useId();
  const [text, setText] = useState(setting?.width === undefined ? '' : String(setting.width));
  const [bad, setBad] = useState(false);
  const fallback = property.config.type === 'title' ? NAME_WIDTH : COLUMN_WIDTH;
  const commit = () => {
    const width = readWidth(text);
    if (width === null) {
      setBad(true);
      return;
    }
    if (width !== setting?.width) onChange({ width });
  };
  return (
    <div className="flex flex-col gap-2 px-1 pb-2 pl-9">
      <div className="flex items-center gap-2">
        <span id={`${id}-width`} className="w-16 text-small text-fg">
          {PROPERTIES_TEXT.width}
        </span>
        <Input
          aria-labelledby={`${id}-width`}
          aria-describedby={`${id}-hint`}
          aria-invalid={bad || undefined}
          inputMode="numeric"
          className="w-24"
          placeholder={String(fallback)}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setBad(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            commit();
          }}
        />
      </div>
      <p
        id={`${id}-hint`}
        role={bad ? 'alert' : undefined}
        className={cn('text-label', bad ? 'text-danger' : 'text-muted')}
      >
        {bad ? PROPERTIES_TEXT.widthError : PROPERTIES_TEXT.widthHint}
      </p>
      <div className="flex items-center gap-2">
        <Switch
          aria-labelledby={`${id}-wrap`}
          checked={setting?.wrap ?? wrapDefault}
          onCheckedChange={(on) => onChange({ wrap: on })}
        />
        <span id={`${id}-wrap`} className="text-small text-fg">
          {PROPERTIES_TEXT.wrap}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Properties → Deleted

function DeletedScreen({ meta, viewer, onBack }: PropertiesPanelProps & { onBack(): void }) {
  const database = useDatabase(meta.id);
  const propertyActions = usePropertyActions(meta.id);
  const [error, setError] = useState('');
  const back = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    back.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <Button ref={back} variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {PROPERTIES_TEXT.back}
      </Button>
      <DeletedProperties
        deleted={database.data?.deletedProperties ?? []}
        actions={propertyActions}
        viewer={viewer}
        canRestore
        onRestored={() => setError('')}
        onError={(e) => setError(errorText(e))}
      />
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
