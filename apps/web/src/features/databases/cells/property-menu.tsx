import {
  defaultConfig,
  TYPE_LABELS,
  type DatabaseMeta,
  type Property,
  type View,
} from '@carehub/databases';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverAnchor,
} from '@carehub/ui';
import {
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronRight,
  Copy,
  EyeOff,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { QueryRow } from '../contract';
import { PROPERTY_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { PropertySettingsPopover, type DatabaseChoice } from './property-settings';
import {
  addedProperty,
  canChangeProperties,
  checkPropertyName,
  clearedByChange,
  hideInView,
  newPropertyTypes,
  placeInView,
  rowsWithValues,
  typeChoices,
  uniquePropertyName,
  viewColumns,
  type NewPropertyType,
  type InsertSide,
  type TargetType,
} from './property-logic';
import { PropertyTypeIcon } from './type-icon';
import type { CellContext, PersonChoice } from './types';

/** What the menu changed, for the caller's announcements, toasts and Undo. */
export type PropertyMenuEvent =
  | { kind: 'renamed'; property: Property; name: string }
  /** `property` as it was before, `cleared` as the server counted it. */
  | { kind: 'type_changed'; property: Property; to: TargetType; cleared: number }
  | { kind: 'hidden'; property: Property }
  /** `property` is the new one, shown `side` of the one whose menu it was. */
  | { kind: 'inserted'; property: Property; side: InsertSide }
  | { kind: 'duplicated'; property: Property; copy: Property }
  | { kind: 'deleted'; property: Property };

export interface PropertyMenuProps {
  meta: Pick<DatabaseMeta, 'viewerAccess' | 'locked' | 'properties' | 'wiki'>;
  property: Property;
  actions: PropertyActions;
  /** The view whose header it is: Hide in this view and Insert left or right change its columns. */
  view?: Pick<View, 'id' | 'properties'>;
  /** Saves the view for everyone (the layout's `actions.updateView`). */
  updateView?: (patch: Partial<View>) => Promise<void>;
  /** The rows on screen, for the counts in the confirms. */
  rows?: readonly QueryRow[];
  ctx: CellContext;
  /** People a Text → Person change can match by name or email. */
  people?: readonly PersonChoice[];
  /** The layout's own items: Filter, Sort, Group by, Calculate, Wrap column. */
  viewItems?: ReactNode;
  /**
   * Opens the property's settings some other way (a formula editor, say). Without it, Edit
   * property opens PropertySettings by the header. Shown to people who can change properties.
   */
  onEditProperty?: () => void;
  /** Opens property access (shown with Full access, not for Name). */
  onPropertyAccess?: () => void;
  /** A two-way relation's other side, named in the delete confirm and in Edit property. */
  twoWay?: { propertyName: string; databaseTitle: string };
  /** Databases the viewer can open, for a relation's settings. */
  databases?: readonly DatabaseChoice[];
  onChanged?: (event: PropertyMenuEvent) => void;
  /** A write the server refused (the menu has closed by then, or the confirm stays open). */
  onError?: (error: unknown) => void;
  /**
   * Opens or closes the menu from outside (from the table's header, say). The menu's own closes
   * come through `onOpenChange`; closing it from outside drops a typed name.
   */
  open?: boolean;
  /** Called when the menu opens or closes, whether `open` is given or not. */
  onOpenChange?: (open: boolean) => void;
  /** The header button that opens the menu. */
  children: ReactElement;
}

type Page = { name: 'main' } | { name: 'type' } | { name: 'new'; side: InsertSide };
type Confirm = { kind: 'type'; to: TargetType; count: number } | { kind: 'delete'; count: number };

/** Moves focus from a field in the menu to the item after (or before) it. */
function focusItemNear(from: HTMLElement, direction: 'next' | 'previous') {
  const items = Array.from(
    from.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
  ).filter((item) => !item.hasAttribute('data-disabled'));
  const following = (item: HTMLElement) =>
    Boolean(from.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
  const target =
    direction === 'next' ? items.find(following) : items.filter((i) => !following(i)).pop();
  target?.focus();
}

/** The sections of a menu with a line between each (empty ones left out). */
function sections(parts: readonly ReactNode[]): ReactNode {
  return parts
    .filter((part) => (Array.isArray(part) ? part.length > 0 : Boolean(part)))
    .map((part, index) => (
      <Fragment key={index}>
        {index > 0 && <DropdownMenuSeparator />}
        {part}
      </Fragment>
    ));
}

/**
 * The menu of a property's header (spec 2, 3.4): rename it, change its type, edit its settings
 * (PropertySettings, by the header), hide it in this view, insert a property beside it, duplicate
 * it, open its access, or delete it. The layout adds its own items (`viewItems`). Changes that
 * clear or remove values ask first and say how many.
 *
 * Renaming saves when the menu closes; Escape leaves without saving (or goes back from the type
 * and new property lists). Everything but the name needs Can edit or Full access with Lock
 * structure off; without them the menu shows the name and the layout's items. With `open` and
 * `onOpenChange` the layout can open it too (from the table's header keys, say).
 */
export function PropertyMenu({
  meta,
  property,
  actions,
  view,
  updateView,
  rows = [],
  ctx,
  people,
  viewItems,
  onEditProperty,
  onPropertyAccess,
  twoWay,
  databases,
  onChanged,
  onError,
  open,
  onOpenChange,
  children,
}: PropertyMenuProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const [page, setPage] = useState<Page>({ name: 'main' });
  const [draft, setDraft] = useState(property.name);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  /** Closed with Escape: the typed name isn't saved. */
  const escaped = useRef(false);
  /** Runs once the menu has closed and given focus back (a confirm or a panel opens then). */
  const afterClose = useRef<(() => void) | null>(null);
  const errorId = useId();
  const newErrorId = useId();

  const type = property.config.type;
  const isTitle = type === 'title';
  const editable = canChangeProperties(meta);
  const choices = editable ? typeChoices(property) : [];
  const inView = editable && view !== undefined && updateView !== undefined;

  // The name field takes focus whenever a page with one opens (stable, so only on mount).
  const focusField = useCallback((el: HTMLInputElement | null) => {
    field.current = el;
    el?.focus();
    el?.select();
  }, []);
  const focusItem = useCallback((el: HTMLDivElement | null) => el?.focus(), []);

  const run = (write: () => Promise<void>) => {
    write().catch((error: unknown) => onError?.(error));
  };

  const saveName = () => {
    const name = draft.trim();
    if (!editable || name === property.name) return;
    if (checkPropertyName(name, meta.properties, property.id)) return;
    run(async () => {
      await actions.update(property.id, { name });
      onChanged?.({ kind: 'renamed', property, name });
    });
  };

  // Each time the menu opens (from its button or from `open`), it starts on its main page.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setPage({ name: 'main' });
      setDraft(property.name);
      setDraftError(null);
    }
  }

  const openChange = (next: boolean) => {
    if (next) {
      afterClose.current = null;
    } else if (escaped.current) {
      escaped.current = false;
    } else {
      saveName();
    }
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  /** Runs `then` once the menu, closing by its item, has given focus back. */
  const later = (then: () => void) => {
    afterClose.current = then;
  };

  const goTo = (event: Event, next: Page) => {
    event.preventDefault();
    if (next.name === 'new') {
      setNewName('');
      setNewError(null);
    }
    setPage(next);
  };

  const changeType = async (to: TargetType, count: number) => {
    const answer = await actions.update(property.id, { config: defaultConfig(to) });
    onChanged?.({ kind: 'type_changed', property, to, cleared: answer.cleared ?? count });
  };

  const chooseType = (to: TargetType) => {
    const count = clearedByChange(property, to, rows, ctx, meta.properties, people);
    if (count > 0) later(() => setConfirm({ kind: 'type', to, count }));
    else run(() => changeType(to, 0));
  };

  /** Adds a property of `kind` beside this one; false (and the menu stays) if the name won't do. */
  const insert = (kind: NewPropertyType, side: InsertSide): boolean => {
    const typed = newName.trim();
    const error = typed ? checkPropertyName(typed, meta.properties) : null;
    if (error) {
      setNewError(error);
      field.current?.focus();
      return false;
    }
    const name = typed || uniquePropertyName(TYPE_LABELS[kind], meta.properties);
    run(async () => {
      const answer = await actions.create({ name, config: defaultConfig(kind) });
      const added = addedProperty(meta.properties, answer.properties);
      if (!added) return;
      if (view && updateView) {
        await updateView({
          properties: placeInView(viewColumns(answer, view), property.id, added.id, side),
        });
      }
      onChanged?.({ kind: 'inserted', property: added, side });
    });
    return true;
  };

  const hide = () =>
    run(async () => {
      if (!view || !updateView) return;
      await updateView({ properties: hideInView(view.properties, property.id) });
      onChanged?.({ kind: 'hidden', property });
    });

  const duplicate = () =>
    run(async () => {
      const answer = await actions.duplicate(property.id);
      const copy = addedProperty(meta.properties, answer.properties);
      if (!copy) return;
      if (view && updateView) {
        await updateView({
          properties: placeInView(viewColumns(answer, view), property.id, copy.id, 'right'),
        });
      }
      onChanged?.({ kind: 'duplicated', property, copy });
    });

  const confirmChange = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await actions.remove(property.id);
        onChanged?.({ kind: 'deleted', property });
      } else {
        await changeType(confirm.to, confirm.count);
      }
      setConfirm(null);
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  };

  // Keys typed into a name field stay there (the menu would jump to an item starting with them);
  // Escape and Tab still reach the menu.
  const fieldKeys = (event: ReactKeyboardEvent<HTMLInputElement>, enter: () => void) => {
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      enter();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusItemNear(event.currentTarget, event.key === 'ArrowDown' ? 'next' : 'previous');
    }
  };

  const back = (
    <DropdownMenuItem onSelect={(event) => goTo(event, { name: 'main' })}>
      <ArrowLeft aria-hidden />
      {PROPERTY_TEXT.back}
    </DropdownMenuItem>
  );

  const header = editable ? (
    <div className="flex flex-col gap-1 p-1">
      <div className="flex items-center gap-2">
        <PropertyTypeIcon type={type} />
        <Input
          ref={focusField}
          aria-label={PROPERTY_TEXT.propertyName}
          value={draft}
          className="h-8"
          aria-invalid={draftError ? true : undefined}
          aria-describedby={draftError ? errorId : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
          onKeyDown={(event) =>
            fieldKeys(event, () => {
              const error = checkPropertyName(draft, meta.properties, property.id);
              if (error) setDraftError(error);
              else openChange(false);
            })
          }
        />
      </div>
      {draftError && (
        <p id={errorId} role="alert" className="px-1 text-small text-danger">
          {draftError}
        </p>
      )}
    </div>
  ) : (
    <DropdownMenuLabel className="flex items-center gap-2">
      <PropertyTypeIcon type={type} />
      <span className="truncate">{property.name}</span>
    </DropdownMenuLabel>
  );

  const typeItems: ReactElement[] = [];
  if (choices.length > 0) {
    typeItems.push(
      <DropdownMenuItem key="type" onSelect={(event) => goTo(event, { name: 'type' })}>
        <PropertyTypeIcon type={type} className="text-fg" />
        {PROPERTY_TEXT.changeType}{' '}
        <span className="ml-auto flex items-center gap-1 text-muted">
          {TYPE_LABELS[type]}
          <ChevronRight aria-hidden />
        </span>
      </DropdownMenuItem>,
    );
  }
  if (editable) {
    typeItems.push(
      <DropdownMenuItem
        key="edit"
        onSelect={() => later(onEditProperty ?? (() => setEditing(true)))}
      >
        <Settings2 aria-hidden />
        {PROPERTY_TEXT.editProperty}
      </DropdownMenuItem>,
    );
  }

  const columnItems: ReactElement[] = [];
  if (inView && !isTitle) {
    columnItems.push(
      <DropdownMenuItem key="hide" onSelect={hide}>
        <EyeOff aria-hidden />
        {PROPERTY_TEXT.hide}
      </DropdownMenuItem>,
      <DropdownMenuItem key="left" onSelect={(event) => goTo(event, { name: 'new', side: 'left' })}>
        <ArrowLeftToLine aria-hidden />
        {PROPERTY_TEXT.insertLeft}
      </DropdownMenuItem>,
    );
  }
  if (inView) {
    columnItems.push(
      <DropdownMenuItem
        key="right"
        onSelect={(event) => goTo(event, { name: 'new', side: 'right' })}
      >
        <ArrowRightToLine aria-hidden />
        {PROPERTY_TEXT.insertRight}
      </DropdownMenuItem>,
    );
  }
  if (editable && !isTitle) {
    columnItems.push(
      <DropdownMenuItem key="duplicate" onSelect={duplicate}>
        <Copy aria-hidden />
        {PROPERTY_TEXT.duplicate}
      </DropdownMenuItem>,
    );
  }
  if (onPropertyAccess && meta.viewerAccess === 'full' && !isTitle) {
    columnItems.push(
      <DropdownMenuItem key="access" onSelect={() => later(onPropertyAccess)}>
        <ShieldCheck aria-hidden />
        {PROPERTY_TEXT.propertyAccess}
      </DropdownMenuItem>,
    );
  }

  const mainPage = sections([
    header,
    typeItems,
    viewItems,
    columnItems,
    editable && !isTitle && (
      <DropdownMenuItem
        variant="danger"
        onSelect={() => {
          const count = rowsWithValues(property, rows);
          later(() => setConfirm({ kind: 'delete', count }));
        }}
      >
        <Trash2 aria-hidden />
        {PROPERTY_TEXT.delete}
      </DropdownMenuItem>
    ),
  ]);

  const typePage = sections([
    back,
    <>
      <DropdownMenuLabel>{PROPERTY_TEXT.changeType}</DropdownMenuLabel>
      {choices.map((to, index) => (
        <DropdownMenuItem
          key={to}
          ref={index === 0 ? focusItem : undefined}
          onSelect={() => chooseType(to)}
        >
          <PropertyTypeIcon type={to} className="text-fg" />
          {TYPE_LABELS[to]}
        </DropdownMenuItem>
      ))}
    </>,
  ]);

  const newPage = (side: InsertSide) =>
    sections([
      back,
      <div className="flex flex-col gap-1 p-1">
        <Input
          ref={focusField}
          aria-label={PROPERTY_TEXT.propertyName}
          placeholder={PROPERTY_TEXT.propertyName}
          value={newName}
          className="h-8"
          aria-invalid={newError ? true : undefined}
          aria-describedby={newError ? newErrorId : undefined}
          onChange={(event) => {
            setNewName(event.target.value);
            setNewError(null);
          }}
          onKeyDown={(event) =>
            fieldKeys(event, () => {
              if (insert('text', side)) openChange(false);
            })
          }
        />
        {newError && (
          <p id={newErrorId} role="alert" className="px-1 text-small text-danger">
            {newError}
          </p>
        )}
      </div>,
      <>
        <DropdownMenuLabel>{PROPERTY_TEXT.type}</DropdownMenuLabel>
        {newPropertyTypes(meta).map((kind) => (
          <DropdownMenuItem
            key={kind}
            onSelect={(event) => {
              if (!insert(kind, side)) event.preventDefault();
            }}
          >
            <PropertyTypeIcon type={kind} className="text-fg" />
            {TYPE_LABELS[kind]}
          </DropdownMenuItem>
        ))}
      </>,
    ]);

  const twoWayLine =
    property.config.type === 'relation' && property.config.twoWayPropertyId
      ? twoWay
        ? PROPERTY_TEXT.twoWay(twoWay.propertyName, twoWay.databaseTitle)
        : PROPERTY_TEXT.twoWayUnnamed
      : null;

  return (
    <Popover open={editing} onOpenChange={setEditing}>
      <DropdownMenu open={isOpen} onOpenChange={openChange}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild ref={trigger}>
            {children}
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="start"
          className="w-72 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
          onEscapeKeyDown={(event) => {
            if (page.name === 'main') {
              escaped.current = true;
            } else {
              event.preventDefault();
              setPage({ name: 'main' });
            }
          }}
          onCloseAutoFocus={(event) => {
            const then = afterClose.current;
            if (!then) return;
            afterClose.current = null;
            event.preventDefault();
            then();
          }}
        >
          <Fragment key={page.name}>
            {page.name === 'main' ? mainPage : page.name === 'type' ? typePage : newPage(page.side)}
          </Fragment>
        </DropdownMenuContent>
      </DropdownMenu>
      <PropertySettingsPopover
        meta={meta}
        property={property}
        actions={actions}
        databases={databases}
        twoWay={twoWay}
        onError={onError}
        returnFocus={trigger}
      />
      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirm(null);
        }}
      >
        {confirm && (
          <DialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {confirm.kind === 'delete'
                  ? PROPERTY_TEXT.deleteTitle(property.name)
                  : PROPERTY_TEXT.changeTitle(property.name, TYPE_LABELS[confirm.to])}
              </DialogTitle>
              <DialogDescription>
                {(confirm.kind === 'delete'
                  ? [
                      confirm.count > 0 ? PROPERTY_TEXT.valuesRemoved(confirm.count) : null,
                      twoWayLine,
                      PROPERTY_TEXT.restoreLater,
                    ]
                  : [PROPERTY_TEXT.valuesCleared(confirm.count)]
                )
                  .filter(Boolean)
                  .join(' ')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                {PROPERTY_TEXT.cancel}
              </Button>
              <Button
                variant={confirm.kind === 'delete' ? 'danger' : 'primary'}
                loading={busy}
                onClick={() => void confirmChange()}
              >
                {confirm.kind === 'delete' ? PROPERTY_TEXT.delete : PROPERTY_TEXT.changeType}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Popover>
  );
}
