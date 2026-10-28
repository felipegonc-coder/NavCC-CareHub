import { createElement, lazy, Suspense } from 'react';
import type { FeatureSlots } from '../../slots';
import { StatusSync } from './settings/StatusSync';

const ClaudeSettings = lazy(() => import('./settings/ClaudeSettings'));

/** What Claude adds to the shell, page view and editor (decision 0007, section 5.3). */
export const slots: FeatureSlots = {
  // Keeps the on/off status that every Claude entry point reads (settings/status.ts).
  overlays: [{ id: 'claude-status', Component: StatusSync }],
  settingsSections: [
    {
      id: 'claude',
      label: 'Claude',
      path: 'claude',
      // Last of the workspace sections (Settings and members spec, section 1).
      order: 900,
      permission: 'workspace.admin',
      element: createElement(Suspense, { fallback: null }, createElement(ClaudeSettings)),
    },
  ],
};
