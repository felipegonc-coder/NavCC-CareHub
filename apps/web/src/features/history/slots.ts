import { Clock, History } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
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
  ],
  overlays: [
    { id: 'history.versions', Component: VersionHistoryOverlay },
    { id: 'history.updates', Component: UpdatesOverlay },
  ],
  pageBanners: [{ id: 'history.watcher', order: 0, Component: HistoryPageWatcher }],
};
