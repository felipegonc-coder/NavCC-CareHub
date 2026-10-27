import { LayoutTemplate } from 'lucide-react';
import type { FeatureSlots } from '../../slots';
import { VariableChipView } from './buttons/variable-chip';
import { TemplatesOverlay } from './overlay';
import { openSaveAsTemplate, saveAllowed } from './save-store';

/** What templates adds to the shell, page view and editor (decision 0007, section 5.3). */
export const slots: FeatureSlots = {
  overlays: [{ id: 'templates', Component: TemplatesOverlay }],
  pageMenuItems: [
    {
      id: 'templates.save',
      label: 'Save as template',
      icon: LayoutTemplate,
      // The page menu's lane items in the pages spec's order: Remind me, Follow, Version history,
      // Save as template, Turn into knowledge base page, Import, Export, Print, Analytics.
      order: 40,
      isVisible: (page) => page.kind === 'page' && saveAllowed(),
      onSelect: (page) => openSaveAsTemplate(page),
    },
  ],
  editor: {
    // Template variables ({{date}}, {{me}}) in pages and templates.
    nodeViews: { templateVariable: VariableChipView },
  },
};
