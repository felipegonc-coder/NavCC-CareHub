import type { TemplateIcon } from '@carehub/extras/templates/gallery';
import { TEMPLATE_VARIABLE_NODE, type TemplateVariable } from '@carehub/extras/templates/content';

// Care Hub's own starter templates (spec 3.1, TB-D1), written for the Customer Care team. All
// names and sample text are fictional. More starters, with their databases, come in later PRs.

export interface StarterPage {
  title: string;
  icon: TemplateIcon | null;
  markdown: string;
  children?: StarterPage[];
}

export interface Starter {
  key: string;
  name: string;
  description: string;
  category: string;
  page: StarterPage;
}

const emoji = (value: string): TemplateIcon => ({
  type: 'emoji',
  emoji: value,
});
/** A variable chip, as the collab feature writes inline nodes in Markdown. */
const chip = (kind: TemplateVariable, offsetDays = 0) =>
  `<!-- carehub:inline ${JSON.stringify({ type: TEMPLATE_VARIABLE_NODE, attrs: { kind, offsetDays } })} -->`;
const lines = (...text: string[]) => `${text.join('\n')}\n`;

export const STARTERS: readonly Starter[] = [
  {
    key: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Agenda, notes and action items for any meeting.',
    category: 'Meetings',
    page: {
      title: 'Meeting notes',
      icon: emoji('📝'),
      markdown: lines(
        `**Date:** ${chip('today')} · **Note taker:** ${chip('me')}`,
        '',
        '## Agenda',
        '',
        '1. Queue health this week',
        '2. Macro updates for billing questions',
        '3. Open questions',
        '',
        '## Notes',
        '',
        '- ',
        '',
        '## Action items',
        '',
        '- [ ] Share the updated refund macro with the team',
        '- [ ] Book a follow-up with the billing team',
      ),
    },
  },
  {
    key: 'weekly-huddle',
    name: 'Weekly huddle',
    description: 'Wins, numbers, blockers and shout-outs for the team’s weekly check-in.',
    category: 'Meetings',
    page: {
      title: 'Weekly huddle',
      icon: emoji('🗓️'),
      markdown: lines(
        `**Week of** ${chip('today')} · **Host:** ${chip('me')}`,
        '',
        '## Wins',
        '',
        '- Cleared the weekend backlog by Monday noon',
        '',
        '## Numbers',
        '',
        '- First reply time: 42 minutes (goal: under 1 hour)',
        '- Customer satisfaction: 94%',
        '',
        '## Blockers',
        '',
        '- ',
        '',
        '## Shout-outs',
        '',
        '- Thanks to Jordan Reyes for covering the late shift',
      ),
    },
  },
];

export const STARTERS_BY_KEY: ReadonlyMap<string, Starter> = new Map(
  STARTERS.map((starter) => [starter.key, starter]),
);
