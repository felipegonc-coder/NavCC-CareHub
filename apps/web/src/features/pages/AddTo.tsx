// The "Add to" picker at the top of a page made with "New page" (Sidebar spec, section 2). The
// page starts at the top of Private; picking a space or a page moves it there, and the picker goes.
import { atLeast } from '@carehub/shared';
import { Button, cn } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { fetchSpaces, pagesKeys, type PageDetail } from './api';
import { columnClasses } from './PageHeader';

interface AddToProps {
  page: PageDetail;
  /** Opens the place picker. */
  onChoose(): void;
}

export function AddTo({ page, onChoose }: AddToProps) {
  const spaces = useQuery({ queryKey: pagesKeys.spaces, queryFn: fetchSpaces });
  const personal = spaces.data?.find((space) => space.kind === 'personal');
  // Only while it's still where "New page" put it, and only if the person may move it.
  if (!personal || page.spaceId !== personal.id || page.parentId !== null) return null;
  if (!atLeast(page.access, 'full') || page.deleted || page.archived) return null;
  return (
    <div
      className={cn(
        columnClasses(page.fullWidth),
        'flex items-center gap-2 pt-4 text-small text-muted',
      )}
    >
      <span aria-hidden>Add to:</span>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Add to: Private"
        aria-haspopup="dialog"
        onClick={onChoose}
      >
        Private
        <ChevronDown aria-hidden />
      </Button>
    </div>
  );
}
