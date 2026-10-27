// The page icon picker (Pages and blocks, section 3.1): search, emoji by group, Random and Remove.
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@carehub/ui';
import { useState, type ReactElement } from 'react';
import { EMOJI_GROUPS, randomEmoji, searchEmoji, type Emoji } from './emoji';
import type { PageIcon } from './types';

export interface IconPickerProps {
  /** The page's icon now; Remove shows only when there is one. */
  icon: PageIcon | null;
  onChange(icon: PageIcon | null): void;
  /** What opens the picker, such as "Add icon" or the icon itself. */
  children: ReactElement;
}

export function IconPicker({ icon, onChange, children }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const found = searchEmoji(query);
  const searching = query.trim() !== '';
  const groups = searching ? [{ name: 'Results', items: found }] : EMOJI_GROUPS;
  const choose = (next: PageIcon | null) => {
    setOpen(false);
    onChange(next);
  };
  const pick = (item: Emoji) => choose({ type: 'emoji', emoji: item.emoji });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" aria-label="Choose an icon" className="w-80 p-0">
        <div className="flex items-center gap-1 border-b p-2">
          <Input
            type="search"
            aria-label="Search emoji"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const [first] = found;
              if (event.key === 'Enter' && first) pick(first);
            }}
            className="min-w-0 flex-1"
          />
          <Button variant="ghost" size="sm" onClick={() => pick(randomEmoji())}>
            Random
          </Button>
          {icon && (
            <Button variant="ghost" size="sm" onClick={() => choose(null)}>
              Remove
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.name} role="group" aria-label={group.name}>
                <h3 className="px-1 py-1 text-label text-muted">{group.name}</h3>
                <div className="grid grid-cols-8 gap-0.5">
                  {group.items.map((item) => (
                    <button
                      key={item.emoji}
                      type="button"
                      aria-label={item.name}
                      title={item.name}
                      onClick={() => pick(item)}
                      className="flex size-8 items-center justify-center rounded text-h3 hover:bg-fill-hover"
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          {searching && found.length === 0 && (
            <p className="px-1 py-2 text-muted">No emoji match.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
