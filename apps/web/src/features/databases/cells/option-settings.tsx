import {
  OPTION_COLORS,
  type ConfigOf,
  type OptionColor,
  type Property,
  type SelectOption,
} from '@carehub/databases';
import { optionUsage, validateOptionName, withoutOption } from '@carehub/databases/options';
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
} from '@carehub/ui';
import { Ellipsis, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { QueryRow } from '../contract';
import { optionColors } from './chips';
import { useDraft } from './draft';
import { OPTION_COLOR_LABELS, PROPERTY_TEXT, SETTINGS_TEXT } from './messages';
import { engineRow } from './row-cell';
import { addSelectOption, recolorOption, renameOption } from './settings-logic';

/** Select and Multi-select settings. */
type ListConfig = ConfigOf<'select'> | ConfigOf<'multi_select'>;

export interface OptionSettingsProps {
  /** A Select or Multi-select property, with any change not saved yet. */
  property: Property<ListConfig>;
  /** The rows on screen, for "3 rows use this option" before a delete. */
  rows: readonly QueryRow[];
  disabled?: boolean;
  /** Saves new settings; resolves to whether the server took them. */
  save: (config: ListConfig) => Promise<boolean>;
}

/**
 * The options of a Select or Multi-select property (spec 3.4): rename in place, pick a color, add,
 * and delete after saying how many rows use it.
 */
export function OptionSettings({ property, rows, disabled = false, save }: OptionSettingsProps) {
  const config = property.config;
  const [confirm, setConfirm] = useState<{ option: SelectOption; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const errorId = useId();
  const list = useRef<HTMLElement>(null);
  /** The option's menu button, for focus after the confirm (if the option is still there). */
  const returnTo = useRef<HTMLElement | null>(null);

  // A refused change is reported by the panel, which shows the saved options again.
  const saveOptions = (options: SelectOption[]) => save({ ...config, options });

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

  return (
    <section ref={list} aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-label font-medium text-muted">
        {SETTINGS_TEXT.options}
      </h3>
      {config.options.length > 0 ? (
        <ul className="flex flex-col">
          {config.options.map((option) => (
            <OptionRow
              key={option.id}
              option={option}
              options={config.options}
              errorId={`${errorId}-${option.id}`}
              disabled={disabled}
              onRename={(name) => saveOptions(renameOption(config.options, option.id, name))}
              onRecolor={(color) => saveOptions(recolorOption(config.options, option.id, color))}
              onDelete={(from) => askDelete(option, from)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted">{SETTINGS_TEXT.noOptions}</p>
      )}
      {!disabled && (
        <AddOption
          label={SETTINGS_TEXT.addOption}
          onAdd={(name) => {
            const added = addSelectOption(config.options, name);
            if ('error' in added) return added.error;
            saveOptions(added.options);
            return null;
          }}
        />
      )}
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
              <DialogDescription>{SETTINGS_TEXT.optionUsed(confirm.count)}</DialogDescription>
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
    </section>
  );
}

/** The field that adds an option: Enter adds it and clears the field for the next one. */
function AddOption({ label, onAdd }: { label: string; onAdd: (name: string) => string | null }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="flex flex-col gap-1">
      <Input
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
  disabled: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: OptionColor) => void;
  /** Gets the option's menu button, where focus goes back after the confirm. */
  onDelete: (from: HTMLElement | null) => void;
}

/** One option: its color, its name (rename in place) and its menu. */
function OptionRow({
  option,
  options,
  errorId,
  disabled,
  onRename,
  onRecolor,
  onDelete,
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
    <li className="flex flex-col gap-1 py-0.5">
      <div className="flex items-center gap-1">
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="danger"
                onSelect={() => {
                  deleting.current = true;
                }}
              >
                <Trash2 aria-hidden />
                {SETTINGS_TEXT.deleteOption}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {name.error && (
        <p id={errorId} role="alert" className="pl-4 text-small text-danger">
          {name.error}
        </p>
      )}
    </li>
  );
}
