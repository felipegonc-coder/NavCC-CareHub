import { useRef, useState } from 'react';
import { Copy, Trash2, X } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from '@carehub/ui';
import type { Property } from '@carehub/databases';
import { CellEditor, type CellContext, type CommitDetails } from './cell-adapter';
import { PROPERTY_ICONS } from './icons';
import { TABLE_TEXT } from './messages';

export interface BulkBarProps {
  count: number;
  /** The properties that can be set for all the ticked rows at once. */
  properties: readonly Property[];
  ctx: CellContext;
  canCreateOptions: boolean;
  onSet(property: Property, value: unknown, details: CommitDetails): void;
  /** Only when the table can duplicate rows (`duplicateRows`) and the viewer can add rows. */
  onDuplicate?: () => void;
  onTrash(): void;
  onClear(): void;
}

/** What shows while rows are ticked: how many, set one property for all of them, Duplicate, Delete. */
export function BulkBar({
  count,
  properties,
  ctx,
  canCreateOptions,
  onSet,
  onDuplicate,
  onTrash,
  onClear,
}: BulkBarProps) {
  const [setting, setSetting] = useState<Property | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Set when a property is picked: the editor that opens keeps the focus, not the menu's button.
  const opening = useRef(false);
  const done = () => {
    setSetting(null);
    trigger.current?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-label={TABLE_TEXT.selectedRows}
      className="fixed inset-x-0 bottom-4 z-20 mx-auto flex w-fit max-w-full items-center gap-1 rounded border border-border bg-bg p-1 text-small text-fg shadow-menu"
    >
      <span className="px-2 text-muted">{TABLE_TEXT.selected(count)}</span>
      {properties.length > 0 && (
        <div className="relative">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={trigger} variant="ghost" size="sm" className="max-md:min-h-11">
                {TABLE_TEXT.setProperty}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-96 overflow-y-auto"
              onCloseAutoFocus={(event) => {
                if (!opening.current) return;
                opening.current = false;
                event.preventDefault();
              }}
            >
              {properties.map((property) => {
                const Icon = PROPERTY_ICONS[property.config.type];
                return (
                  <DropdownMenuItem
                    key={property.id}
                    onSelect={() => {
                      opening.current = true;
                      setSetting(property);
                    }}
                  >
                    <Icon aria-hidden className="size-4 text-muted" />
                    <span className="truncate">{property.name}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {setting && (
            <CellEditor
              key={setting.id}
              property={setting}
              value={null}
              ctx={ctx}
              canCreateOptions={canCreateOptions}
              onCommit={(value, details) => {
                done();
                if (details.changed) onSet(setting, value, details);
              }}
              onCancel={done}
            />
          )}
        </div>
      )}
      {onDuplicate && (
        <Button variant="ghost" size="sm" onClick={onDuplicate} className="max-md:min-h-11">
          <Copy aria-hidden className="size-4" />
          {TABLE_TEXT.duplicate}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onTrash} className="max-md:min-h-11">
        <Trash2 aria-hidden className="size-4" />
        {TABLE_TEXT.delete}
      </Button>
      <IconButton
        label={TABLE_TEXT.clearSelection}
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="max-md:min-h-11 max-md:min-w-11"
      >
        <X aria-hidden className="size-4" />
      </IconButton>
    </div>
  );
}
