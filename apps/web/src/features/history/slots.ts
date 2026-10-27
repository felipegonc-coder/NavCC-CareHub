import { Archive, Clock, History } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
import { isKnownArchived, openArchive } from './archive';
import { ArchiveBanner } from './ArchiveBanner';
import { ArchiveDialog } from './ArchiveDialog';
import { HistoryPageWatcher } from './HistoryPageWatcher';
import { openVersionHistory } from './store';
import { UpdatesOverlay } from './UpdatesOverlay';
import { openUpdates } from './updatesStore';
import { VersionHistoryOverlay } from './VersionHistoryOverlay';

/** What history adds to the shell, page view and editor (decision 0007, section 5.3). */
export const slots: FeatureSlots = {
  pageMenuItems: [
    {
      id: 'history.versions',
      label: 'Version history',
      icon: History,
      order: 60,
      // A database's rows keep their own history; the database itself has no versions.
      isVisible: (page) => page.kind !== 'database',
      onSelect: (page) => openVersionHistory(page),
    },
    // Can view is enough (HT-08); the panel says so when the person lacks it.
    { id: 'history.updates', label: 'Updates', icon: Clock, order: 61, onSelect: openUpdates },
    // Pages and databases (Full access, HT-14); a row goes along with its database. An archived
    // page has Unarchive in its banner instead.
    {
      id: 'history.archive',
      label: 'Archive',
      icon: Archive,
      order: 62,
      isVisible: (page) => page.kind !== 'row' && !isKnownArchived(page.id),
      onSelect: openArchive,
    },
  ],
  overlays: [
    { id: 'history.versions', Component: VersionHistoryOverlay },
    { id: 'history.updates', Component: UpdatesOverlay },
    { id: 'history.archive', Component: ArchiveDialog },
  ],
  pageBanners: [
    { id: 'history.watcher', order: 0, Component: HistoryPageWatcher },
    { id: 'history.archive', order: 10, Component: ArchiveBanner },
  ],
};
