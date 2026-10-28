import { Download, Printer } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
import { ExportOverlay } from './export/ExportOverlay';
import { exportAllowed, goTo, openExportDialog, printPath } from './export/store';

/** What import and export adds to the shell, page view and editor (decision 0007, section 5.3). */
export const slots: FeatureSlots = {
  pageMenuItems: [
    {
      // Hidden when they can't export the page (IE-16); direct requests get 403 too.
      id: 'import-export.export',
      label: 'Export',
      icon: Download,
      order: 70,
      isVisible: (page) => exportAllowed(page.id),
      onSelect: (page) => openExportDialog(page),
    },
    {
      // Print needs only Can view, so it shows even when exports are turned off (IE-16).
      id: 'import-export.print',
      label: 'Print',
      icon: Printer,
      order: 71,
      onSelect: (page) => goTo(printPath(page.id, { dialog: true })),
    },
  ],
  overlays: [{ id: 'import-export.export', Component: ExportOverlay }],
};
