import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@carehub/ui';
import { SlidersHorizontal } from 'lucide-react';
import type { HomeSectionEntry } from './sections';
import {
  DEFAULT_HOME_SETTINGS,
  useChangeHomeSettings,
  useHomeSettings,
  withSection,
} from './settings';

/**
 * Customize Home: a menu that shows or hides each section, only for this person (HR-06). It waits
 * for their settings, so a change never replaces ones it hasn't seen.
 */
export function CustomizeHome({ sections }: { sections: readonly HomeSectionEntry[] }) {
  const settings = useHomeSettings();
  const change = useChangeHomeSettings();
  const hidden = settings.data?.hiddenSections ?? DEFAULT_HOME_SETTINGS.hiddenSections;
  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!settings.isSuccess}>
            <SlidersHorizontal aria-hidden />
            Customize Home
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Show on Home</DropdownMenuLabel>
          {sections.map(({ id, title }) => (
            <DropdownMenuCheckboxItem
              key={id}
              checked={!hidden.includes(id)}
              onCheckedChange={(checked) =>
                change.mutate({ hiddenSections: withSection(hidden, id, checked === true) })
              }
              // The menu stays open, so several sections can be changed in a row.
              onSelect={(event) => event.preventDefault()}
            >
              {title}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {change.isError && (
        <p role="alert" className="text-small text-danger">
          Couldn&apos;t save that change. Try again.
        </p>
      )}
    </div>
  );
}
