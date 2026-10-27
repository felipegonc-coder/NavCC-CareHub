// The sidebar's Trash: opens Trash, and takes entries dropped on it (Sidebar spec, section 3.2).
import { cn, sidebarRowClasses } from '@carehub/ui';
import { Trash2 } from 'lucide-react';
import { NavLink } from 'react-router';
import { atLeast } from './access';
import { useMoveToTrash } from './actions';
import { useDropZone } from './drag';

export default function TrashLink() {
  const moveToTrash = useMoveToTrash();
  const { over, zone } = useDropZone((page) => atLeast(page.access, 'full'), moveToTrash);
  return (
    <NavLink
      to="/trash"
      {...zone}
      className={({ isActive }: { isActive: boolean }) =>
        cn(sidebarRowClasses({ active: isActive }), over && 'ring-2 ring-inset ring-primary')
      }
    >
      <Trash2 aria-hidden />
      <span>Trash</span>
    </NavLink>
  );
}
