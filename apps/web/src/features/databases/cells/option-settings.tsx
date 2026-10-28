import {
  OPTION_COLORS,
  type ConfigOf,
  type OptionColor,
  type SelectOption,
  type StatusGroup,
  type StatusOption,
} from '@carehub/databases';
import {
  canDeleteStatusOption,
  optionUsage,
  validateOptionName,
  withoutOption,
  type OptionConfig,
  type OptionProperty,
} from '@carehub/databases/options';
import {
  Button,
  cn,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  VisuallyHidden,
} from '@carehub/ui';
import { Ellipsis, Plus, Trash2 } from 'lucide-react';
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import type { QueryRow } from '../contract';
import { optionColors } from './chips';
import { DragHandle, dragItemClass } from './drag-handle';
import { useDraft } from './draft';
import { OPTION_COLOR_LABELS, PROPERTY_TEXT, SETTINGS_TEXT, STATUS_GROUP_LABELS } from './messages';
import { useReorder, type Reorder } from './reorder';
import { engineRow } from './row-cell';
import {
  addSelectOption,
  addStatusOption,
  moveInGroup,
  moveItem,
  moveToGroup,
  recolorOption,
  renameOption,
  statusGroups,
} from './settings-logic';

export interface OptionSettingsProps {
  /** A Select, Multi-select or Status property, with any change not saved yet. */
  property: OptionProperty;
  /** The rows on screen, for "3 rows use this option" before a delete. */
  rows: readonly QueryRow[];
  /** `rows` isn't every row: the count says "at least". */
  moreRows?: boolean;
  disabled?: boolean;
  /** Saves new settings; resolves to whether the server took them. */
  save: (config: OptionConfig) => Promise<boolean>;
}

/**
 * The options of a Select, Multi-select or Status property (spec 3.4): rename, recolor, drag to
 * reorder (or arrow keys on the handle), add, and delete after saying how many rows use it. Status
 * options sit in To-do, In progress and Complete; each group keeps at least one, one of them is
 * the default for new rows, and an option can move to another group.
 */
export function OptionSettings({
  property,
  rows,
  moreRows = false,
  disabled = false,
  save,
}: OptionSettingsProps) {
  const config = property.config;
  const [confirm, setConfirm] = useState<{ option: SelectOption; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  const headingId = useId();
  const errorId = useId();
  const list = useRef<HTMLDivElement>(null);
  /** The option's menu button, for focus after the confirm (if the option is still there). */
  const returnTo = useRef<HTMLElement | null>(null);

  const askDelete = (option: SelectOption, from: HTMLElement | null) => {
    returnTo.current = from;
    setConfirm({ option, count: optionUsage(rows.map(engineRow), property, option.id) });
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    // When the server refuses, the confirm stays open to try again.
    if (await save(withoutOption(config, confirm.option.id))) setConfirm(null);
    setBusy(false);
  };

  // A refused change is reported by the panel, which shows the saved options again.
  const rowProps = (option: SelectOption) => ({
    options: config.options,
    errorId: `${errorId}-${option.id}`,
    hintId,
    disabled,
    onDelete: (from: HTMLElement | null) => askDelete(option, from),
  });

  let body: ReactNode;
  if (config.type === 'status') {
    const groups = statusGroups(config.options);
    const saveStatus = (options: StatusOption[], change?: Partial<ConfigOf<'status'>>) =>
      save({ ...config, ...change, options });
    body = groups.map(({ group, options }) => (
      <StatusSection
        key={group}
        group={group}
        options={options}
        disabled={disabled}
        onMove={(from, to) => saveStatus(moveInGroup(config.options, group, from, to))}
        onAdd={(name) => {
          const added = addStatusOption(config, group, name);
          if ('error' in added) return added.error;
          saveStatus(added.options);
          return null;
        }}
      >
        {(option, index, reorder) => (
          <OptionRow
            key={option.id}
            option={option}
            index={index}
            reorder={reorder}
            {...rowProps(option)}
            isDefault={option.id === config.defaultOptionId}
            canDelete={canDeleteStatusOption(config, option.id)}
            onRename={(name) => saveStatus(renameOption(config.options, option.id, name))}
            onRecolor={(color) => saveStatus(recolorOption(config.options, option.id, color))}
            extraItems={
              <>
                {option.id !== config.defaultOptionId && (
                  <DropdownMenuItem
                    onSelect={() => saveStatus(config.options, { defaultOptionId: option.id })}
                  >
                    {SETTINGS_TEXT.setDefault}
                  </DropdownMenuItem>
                )}
                {groups
                  .filter((g) => g.group !== group)
                  .map((g) => (
                    <DropdownMenuItem
                      key={g.group}
                      disabled={!canDeleteStatusOption(config, option.id)}
                      onSelect={() => saveStatus(moveToGroup(config.options, option.id, g.group))}
                    >
                      {SETTINGS_TEXT.moveTo(STATUS_GROUP_LABELS[g.group])}
                    </DropdownMenuItem>
                  ))}
              </>
            }
          />
        )}
      </StatusSection>
    ));
  } else {
    const saveOptions = (options: SelectOption[]) => save({ ...config, options });
    body = (
      <SelectSection
        headingId={headingId}
        options={config.options}
        disabled={disabled}
        onMove={(from, to) => saveOptions(moveItem(config.options, from, to))}
        onAdd={(name) => {
          const added = addSelectOption(config.options, name);
          if ('error' in added) return added.error;
          saveOptions(added.options);
          return null;
        }}
      >
        {(option, index, reorder) => (
          <OptionRow
            key={option.id}
            option={option}
            index={index}
            reorder={reorder}
            {...rowProps(option)}
            canDelete
            onRename={(name) => saveOptions(renameOption(config.options, option.id, name))}
            onRecolor={(color) => saveOptions(recolorOption(config.options, option.id, color))}
          />
        )}
      </SelectSection>
    );
  }

  return (
    <div ref={list} className="flex flex-col gap-2">
      <VisuallyHidden id={hintId}>{SETTINGS_TEXT.moveHint}</VisuallyHidden>
      {config.type === 'status' && (
        <p className="text-small text-muted">{SETTINGS_TEXT.defaultHint}</p>
      )}
      {body}
      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirm(null);
        }}
      >
        {confirm && (
          <DialogContent
            onCloseAutoFocus={(event) => {
              // Back to the option's menu button, or the list's first control once it's deleted.
              event.preventDefault();
              const back = returnTo.current;
              if (back?.isConnected) back.focus();
              else list.current?.querySelector<HTMLElement>('input, button')?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{PROPERTY_TEXT.deleteTitle(confirm.option.name)}</DialogTitle>
              <DialogDescription>
                {SETTINGS_TEXT.optionUsed(confirm.count, moreRows)}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                {PROPERTY_TEXT.cancel}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>
                {PROPERTY_TEXT.delete}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

type RenderRow<O extends SelectOption> = (option: O, index: number, reorder: Reorder) => ReactNode;

/** Select and Multi-select: one list and a field to add an option. */
function SelectSection({
  headingId,
  options,
  disabled,
  onMove,
  onAdd,
  children,
}: {
  headingId: string;
  options: readonly SelectOption[];
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onAdd: (name: string) => string | null;
  children: RenderRow<SelectOption>;
}) {
  const reorder = useReorder(options.length, onMove);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-label font-medium text-muted">
        {SETTINGS_TEXT.options}
      </h3>
      {options.length > 0 ? (
        <ul className="flex flex-col">
          {options.map((option, index) => children(option, index, reorder))}
        </ul>
      ) : (
        <p className="text-small text-muted">{SETTINGS_TEXT.noOptions}</p>
      )}
      {!disabled && <AddOption label={SETTINGS_TEXT.addOption} onAdd={onAdd} />}
    </section>
  );
}

/** One status group: its options, and "+" to add one to it. */
function StatusSection({
  group,
  options,
  disabled,
  onMove,
  onAdd,
  children,
}: {
  group: StatusGroup;
  options: readonly StatusOption[];
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onAdd: (name: string) => string | null;
  children: RenderRow<StatusOption>;
}) {
  const reorder = useReorder(options.length, onMove);
  const [adding, setAdding] = useState(false);
  const headingId = useId();
  const label = STATUS_GROUP_LABELS[group];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-label font-medium text-muted">
          {label}
        </h3>
        {!disabled && (
          <IconButton
            label={SETTINGS_TEXT.addOptionTo(label)}
            size="sm"
            aria-expanded={adding}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
          </IconButton>
        )}
      </div>
      <ul className="flex flex-col">
        {options.map((option, index) => children(option, index, reorder))}
      </ul>
      {adding && (
        <AddOption
          label={SETTINGS_TEXT.addOptionTo(label)}
          focus
          onAdd={onAdd}
          onLeave={() => setAdding(false)}
        />
      )}
    </section>
  );
}

/** The field that adds an option: Enter adds it and clears the field for the next one. */
function AddOption({
  label,
  focus = false,
  onAdd,
  onLeave,
}: {
  label: string;
  focus?: boolean;
  onAdd: (name: string) => string | null;
  /** Leaving the field empty (status groups hide it again). */
  onLeave?: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const focusField = useCallback(
    (el: HTMLInputElement | null) => {
      if (focus) el?.focus();
    },
    [focus],
  );
  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={focusField}
        aria-label={label}
        placeholder={SETTINGS_TEXT.addOption}
        value={text}
        className="h-8"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (!text.trim()) onLeave?.();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!text.trim()) return;
          const problem = onAdd(text);
          setError(problem);
          if (!problem) setText('');
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface OptionRowProps {
  option: SelectOption;
  /** Every option of the property, for the name check. */
  options: readonly SelectOption[];
  /** The id for this option's name error. */
  errorId: string;
  index: number;
  reorder: Reorder;
  hintId: string;
  disabled: boolean;
  isDefault?: boolean;
  canDelete: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: OptionColor) => void;
  /** Gets the option's menu button, where focus goes back after the confirm. */
  onDelete: (from: HTMLElement | null) => void;
  /** More menu items (status). */
  extraItems?: ReactNode;
}

/** One option: drag handle, color, name (rename in place) and its menu. */
function OptionRow({
  option,
  options,
  errorId,
  index,
  reorder,
  hintId,
  disabled,
  isDefault = false,
  canDelete,
  onRename,
  onRecolor,
  onDelete,
  extraItems,
}: OptionRowProps) {
  const name = useDraft(option.name, (text) => {
    const problem = validateOptionName(text, options, option.id);
    if (!problem && text.trim() !== option.name) onRename(text);
    return problem;
  });
  const menuButton = useRef<HTMLButtonElement>(null);
  /** Delete was picked: the confirm opens once the menu has closed and given focus back. */
  const deleting = useRef(false);
  return (
    <li
      ref={reorder.item(index)}
      className={cn('flex flex-col gap-1 py-0.5', dragItemClass(reorder, index))}
    >
      <div className="flex items-center gap-1">
        <DragHandle
          reorder={reorder}
          index={index}
          label={SETTINGS_TEXT.moveOption(option.name)}
          hintId={hintId}
          disabled={disabled}
        />
        <span
          aria-hidden
          className={cn(
            'size-3 shrink-0 rounded-full border border-border',
            optionColors(option.color).bg,
          )}
        />
        <Input
          aria-label={SETTINGS_TEXT.renameOption(option.name)}
          value={name.value}
          disabled={disabled}
          className="h-8 min-w-0 flex-1"
          aria-invalid={name.error ? true : undefined}
          aria-describedby={name.error ? errorId : undefined}
          onChange={(event) => name.change(event.target.value)}
          onBlur={() => name.commit()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            name.commit();
          }}
        />
        {isDefault && (
          <span className="shrink-0 text-small text-muted">{SETTINGS_TEXT.isDefault}</span>
        )}
        {!disabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton ref={menuButton} label={SETTINGS_TEXT.editOption(option.name)} size="sm">
                <Ellipsis aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-56 overflow-y-auto"
              onCloseAutoFocus={() => {
                if (!deleting.current) return;
                deleting.current = false;
                onDelete(menuButton.current);
              }}
            >
              <DropdownMenuLabel>{SETTINGS_TEXT.color}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={option.color}
                onValueChange={(value) => {
                  const color = OPTION_COLORS.find((c) => c === value);
                  if (color && color !== option.color) onRecolor(color);
                }}
              >
                {OPTION_COLORS.map((color) => (
                  <DropdownMenuRadioItem key={color} value={color}>
                    <span
                      aria-hidden
                      className={cn(
                        'size-3 shrink-0 rounded-sm border border-border',
                        optionColors(color).bg,
                      )}
                    />
                    {OPTION_COLOR_LABELS[color]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {extraItems && (
                <>
                  <DropdownMenuSeparator />
                  {extraItems}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="danger"
                disabled={!canDelete}
                onSelect={() => {
                  deleting.current = true;
                }}
              >
                <Trash2 aria-hidden />
                {SETTINGS_TEXT.deleteOption}
              </DropdownMenuItem>
              {!canDelete && (
                <p className="px-2 py-1 text-small text-muted">{SETTINGS_TEXT.keepOne}</p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {name.error && (
        <p id={errorId} role="alert" className="pl-7 text-small text-danger">
          {name.error}
        </p>
      )}
    </li>
  );
}
