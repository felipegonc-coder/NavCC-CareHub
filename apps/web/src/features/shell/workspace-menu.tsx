import { APP_NAME } from '@carehub/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Logo,
} from '@carehub/ui';
import { ChevronsUpDown, LogOut, Settings } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useSignOut } from '../auth';

interface WorkspaceMenuProps {
  /** Called when the menu opens another screen, to close the phone menu. */
  onNavigate: (() => void) | undefined;
}

// Rendered only while the menu is open, so the closed shell needs no query or toast providers.
function WorkspaceMenuItems({ onNavigate }: WorkspaceMenuProps) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          onNavigate?.();
          void navigate('/settings');
        }}
      >
        <Settings aria-hidden />
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void signOut()}>
        <LogOut aria-hidden />
        Sign out
      </DropdownMenuItem>
    </>
  );
}

/**
 * The workspace switcher at the top of the sidebar: the workspace, and a menu with Settings and
 * Sign out. Other workspaces, Invite members and Create workspace come with the accounts PRs.
 */
export function WorkspaceMenu({ onNavigate }: WorkspaceMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left transition-colors hover:bg-fill-hover focus-visible:outline-offset-inset max-md:h-11">
        <Logo size={24} decorative />
        <span className="truncate text-small font-medium">{APP_NAME}</span>
        <ChevronsUpDown aria-hidden className="ml-auto size-4 shrink-0 text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <WorkspaceMenuItems onNavigate={onNavigate} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
