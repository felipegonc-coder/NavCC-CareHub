import { describe, expect, it } from 'vitest';
import { WORKSPACE_CATEGORY, type TemplateCard } from './gallery';
import { inCategory, outline, previewBlocks } from './preview';

function card(id: string, name: string, category: string, extra: Partial<TemplateCard> = {}) {
  const base: TemplateCard = {
    id,
    kind: 'starter',
    name,
    description: '',
    category,
    icon: null,
    by: 'Care Hub',
    contents: { subPages: 0, databases: 0, sampleRows: 0 },
    audience: { type: 'everyone' },
    hidden: false,
    canManage: false,
  };
  return { ...base, ...extra };
}

const cards = [
  card('weekly-huddle', 'Weekly huddle', 'Meetings', { description: 'Wins, blockers, shout-outs' }),
  card('meeting-notes', 'Meeting notes', 'Meetings', { description: 'Agenda and action items' }),
  card('shift-handover', 'Shift handover', 'Support', {
    description: 'Open tickets for the next shift',
  }),
  card('a3', 'Escalation playbook', 'Escalations', { kind: 'workspace', by: 'Sam Ortiz' }),
];

describe('inCategory', () => {
  it('lists every workspace template under Made in this workspace', () => {
    expect(inCategory(cards, WORKSPACE_CATEGORY).map((found) => found.id)).toEqual(['a3']);
    expect(inCategory(cards, 'Meetings')).toHaveLength(2);
  });
});

describe('outline', () => {
  it('orders pages depth first under their parents', () => {
    const page = (key: number, parentKey: number | null) => ({
      key,
      parentKey,
      kind: 'page' as const,
      title: `Page ${key}`,
      icon: null,
    });
    const rows = outline([page(2, 0), page(0, null), page(3, 1), page(1, 0)]);
    expect(rows.map(({ page: { key }, depth }) => [key, depth])).toEqual([
      [0, 0],
      [2, 1],
      [1, 1],
      [3, 2],
    ]);
  });
});

const chip = (kind: string) =>
  `<!-- carehub:inline ${JSON.stringify({ type: 'templateVariable', attrs: { kind } })} -->`;

describe('previewBlocks', () => {
  it('reads headings, lists, checkboxes, quotes, code, rules and other blocks', () => {
    const markdown = [
      '# Weekly huddle',
      '',
      'Notes for **the team** on [Agenda](</p/x>) by ' + chip('me'),
      '',
      '- [ ] Review the queue',
      '  - [x] Check SLAs',
      '1. First',
      '> Remember to breathe',
      '',
      '```',
      'code here',
      '```',
      '---',
      '<!-- carehub:block {"type":"actionButton","attrs":{"label":"Start"}} -->',
    ].join('\n');
    expect(previewBlocks(markdown)).toEqual([
      { type: 'heading', level: 1, text: 'Weekly huddle' },
      { type: 'paragraph', text: 'Notes for the team on Agenda by @Me' },
      { type: 'item', text: 'Review the queue', depth: 0, checked: false },
      { type: 'item', text: 'Check SLAs', depth: 1, checked: true },
      { type: 'item', text: 'First', depth: 0, ordered: true },
      { type: 'quote', text: 'Remember to breathe' },
      { type: 'code', text: 'code here' },
      { type: 'divider' },
      { type: 'block', node: 'actionButton' },
    ]);
  });
});
