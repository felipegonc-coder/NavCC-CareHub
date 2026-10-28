/**
 * The toolbar (spec section 2): Filter, Sort, Group, Search, Properties, "…" (Layout, Import CSV,
 * Export CSV, Lock structure, Row access, Property access, Copy link, Delete) and New. Panels open
 * one at a time under it; the dialog panels show from DatabaseView. On phones it becomes one
 * "View options" button (section 6).
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Ellipsis } from 'lucide-react';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@carehub/ui';
import { DIALOG_PANELS, PANEL_LABELS, type PanelProps } from '../contract';
import { useUpdateDatabase } from '../hooks';
import { PanelBody, type Panels } from './panel-host';
import type { Search } from './search';
import { errorText, TOUCH } from './states';
import { useToasts, type Toasts } from './toasts';
import {
  COPY_TEXT,
  databaseLink,
  MORE_LABELS,
  moreItems,
  opensPanel,
  TOOL_LABELS,
  toolIsOn,
  toolsFor,
  type MoreItem,
  type Tool,
} from './tools';

export interface ToolbarProps extends Omit<PanelProps, 'panel' | 'close'> {
  online: boolean;
  panels: Panels;
  search: Search;
  /** New; absent when the person can't add rows here. */
  onNew?: () => void;
  /** Delete in "…" (Full access): moves the database to Trash. */
  onDelete?: () => void;
  /** A block in a page: the toolbar shows on hover or focus. */
  inline?: boolean;
}

export function Toolbar({
  online,
  panels,
  search,
  onNew,
  onDelete,
  inline,
  ...shared
}: ToolbarProps) {
  const { meta, view, savedView, canEditViews } = shared;
  const toasts = useToasts();
  const updateDatabase = useUpdateDatabase(meta.id);
  const box = useRef<HTMLDivElement | null>(null);
  const searchButton = useRef<HTMLButtonElement | null>(null);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const phoneButton = useRef<HTMLButtonElement | null>(null);
  // A menu item that opens a panel or the search box keeps focus there, not on the menu's button.
  const keepFocus = useRef(false);
  // Esc in the search box gives focus back to Search (View options on a phone).
  const refocus = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (search.open || !refocus.current) return;
    refocus.current = false;
    searchButton.current?.focus();
    // Search is hidden on a phone, so focus didn't move.
    if (document.activeElement !== searchButton.current) phoneButton.current?.focus();
  }, [search.open]);

  const tools = toolsFor(view.layout, canEditViews);
  const more = moreItems({
    access: meta.viewerAccess,
    locked: meta.locked,
    online,
    canDelete: onDelete !== undefined,
  });
  const open = panels.open;
  const popover = open !== null && !DIALOG_PANELS.has(open) ? open : null;

  // View options on a phone lists the toolbar's buttons.
  const openTool = (tool: Tool, opener: HTMLElement | null) => {
    keepFocus.current = true;
    if (tool === 'search') search.show();
    else panels.show(tool, opener);
  };

  const run = (item: MoreItem, opener: HTMLElement | null) => {
    if (opensPanel(item)) {
      keepFocus.current = true;
      panels.show(item, opener);
    } else if (item === 'lock') {
      updateDatabase
        .mutateAsync({ locked: !meta.locked })
        .catch((error: unknown) => toasts.show({ message: errorText(error) }));
    } else if (item === 'copyLink') {
      void copyLink(databaseLink(window.location.origin, meta.id, savedView.id), toasts);
    } else {
      onDelete?.();
    }
  };

  const menuFocus = (event: Event) => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    event.preventDefault();
  };

  // An inline block's toolbar stays in sight while something in it is open.
  const busy = open !== null || search.open || menuOpen;

  return (
    <Popover
      open={popover !== null}
      onOpenChange={(next) => {
        if (!next) panels.dismiss();
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={box}
          className={cn(
            'flex shrink-0 items-center gap-1 border-b border-border pb-1',
            search.open && 'max-md:flex-1',
            inline &&
              !busy &&
              'md:opacity-0 md:focus-within:opacity-100 md:group-hover/database:opacity-100',
          )}
        >
          {tools.map((tool) =>
            tool === 'search' ? (
              search.open ? (
                <SearchBox
                  key={tool}
                  search={search}
                  onEscape={() => {
                    refocus.current = true;
                    search.clear();
                  }}
                />
              ) : (
                <Button
                  key={tool}
                  ref={searchButton}
                  size="sm"
                  variant="ghost"
                  className="max-md:hidden"
                  onClick={search.show}
                >
                  {TOOL_LABELS.search}
                </Button>
              )
            ) : (
              <Button
                key={tool}
                size="sm"
                variant="ghost"
                aria-haspopup="dialog"
                aria-expanded={open === tool}
                className={cn('max-md:hidden', toolIsOn(tool, view, search.query) && 'bg-fill')}
                onClick={(e) => panels.toggle(tool, e.currentTarget)}
              >
                {TOOL_LABELS[tool]}
              </Button>
            ),
          )}
          <MoreMenu
            button={moreButton}
            items={more}
            locked={meta.locked}
            onRun={run}
            onOpenChange={setMenuOpen}
            onCloseAutoFocus={menuFocus}
          />
          <MoreMenu
            phone
            button={phoneButton}
            tools={tools}
            onTool={openTool}
            items={more}
            locked={meta.locked}
            onRun={run}
            onOpenChange={setMenuOpen}
            onCloseAutoFocus={menuFocus}
          />
          {onNew && (
            <Button size="sm" className={TOUCH} onClick={onNew}>
              New
            </Button>
          )}
        </div>
      </PopoverAnchor>
      {popover && (
        <PopoverContent
          align="end"
          aria-label={PANEL_LABELS[popover]}
          className="w-auto max-w-dialog"
          // The toolbar's own buttons open, switch and close panels themselves.
          onInteractOutside={(e) => {
            if (e.target instanceof Node && box.current?.contains(e.target)) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            // Esc in the search box empties the search and leaves the panel open.
            if (e.target instanceof HTMLInputElement && box.current?.contains(e.target)) return;
            panels.close();
          }}
          onCloseAutoFocus={panels.closeAutoFocus}
        >
          <PanelBody {...shared} panel={popover} close={panels.close} />
        </PopoverContent>
      )}
    </Popover>
  );
}

interface MoreMenuProps {
  /** View options, which on phones also lists the toolbar's buttons; otherwise "…". */
  phone?: boolean;
  /** The menu's button, where focus goes back when a panel it opened closes. */
  button: RefObject<HTMLButtonElement | null>;
  tools?: readonly Tool[];
  onTool?: (tool: Tool, opener: HTMLElement | null) => void;
  items: readonly MoreItem[];
  locked: boolean;
  onRun(item: MoreItem, opener: HTMLElement | null): void;
  onOpenChange(open: boolean): void;
  onCloseAutoFocus(event: Event): void;
}

/** "…", or View options on phones. Panels it opens give focus back to its button. */
function MoreMenu({
  phone,
  button,
  tools = [],
  onTool,
  items,
  locked,
  onRun,
  onOpenChange,
  onCloseAutoFocus,
}: MoreMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {phone ? (
          <Button ref={button} size="sm" variant="ghost" className={cn('md:hidden', TOUCH)}>
            View options
          </Button>
        ) : (
          <IconButton ref={button} label="More actions" size="sm" className="max-md:hidden">
            <Ellipsis aria-hidden />
          </IconButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
        {tools.map((tool) => (
          <DropdownMenuItem key={tool} onSelect={() => onTool?.(tool, button.current)}>
            {TOOL_LABELS[tool]}
          </DropdownMenuItem>
        ))}
        {tools.length > 0 && items.length > 0 && <DropdownMenuSeparator />}
        {items.map((item) =>
          item === 'lock' ? (
            <DropdownMenuCheckboxItem
              key={item}
              checked={locked}
              onCheckedChange={() => onRun(item, button.current)}
            >
              {MORE_LABELS.lock}
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuItem
              key={item}
              variant={item === 'delete' ? 'danger' : 'default'}
              onSelect={() => onRun(item, button.current)}
            >
              {MORE_LABELS[item]}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search: Esc empties and closes it, and so does leaving it empty. */
function SearchBox({ search, onEscape }: { search: Search; onEscape: () => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <Input
      ref={input}
      type="search"
      aria-label={TOOL_LABELS.search}
      placeholder={TOOL_LABELS.search}
      value={search.text}
      className="w-48 max-md:min-w-0 max-md:flex-1"
      onChange={(e) => search.type(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onEscape();
      }}
      onBlur={() => {
        if (search.text.trim() === '') search.clear();
      }}
    />
  );
}

async function copyLink(link: string, toasts: Toasts) {
  try {
    await navigator.clipboard.writeText(link);
    toasts.show({ message: COPY_TEXT.copied });
  } catch {
    toasts.show({ message: COPY_TEXT.failed });
  }
}
