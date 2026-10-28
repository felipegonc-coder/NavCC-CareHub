// "/button" in the page editor: a button block; its settings open once the button is made.
import type { SlashItem } from '@carehub/editor';
import { MousePointerClick } from 'lucide-react';
import { markAdding } from './store';

export const buttonSlashItem: SlashItem = {
  id: 'actionButton',
  title: 'Button',
  description: 'Does a set of steps when pressed',
  icon: <MousePointerClick size={18} />,
  keywords: ['button', 'action', 'automation', 'insert', 'add row'],
  group: 'Advanced',
  run: (editor) => {
    markAdding(editor);
    editor
      .chain()
      .focus()
      .insertContent({ type: 'actionButton', attrs: { buttonId: null } })
      .run();
  },
};
