import { ME } from '@carehub/databases/types';
import { starterDatabase, starterKit, type StarterDatabaseBuild } from './databases';

// The databases of Care Hub's starter templates (spec 3.1, TB-D1 and TB-17). Names, tickets and
// notes are fictional. Sample dates count from the day the template is used.

const md = (...text: string[]) => `${text.join('\n')}\n`;
/** A fixed day, for dates that don't move with the day the template is used. */
const onDay = (start: string) => ({ start, end: null, hasTime: false });

/** Project tracker: projects with an owner, a priority and dates. */
export const projectTracker: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const status = (name: string) => k.option('status', name);
  const priority = (name: string) => k.option('priority', name);
  return starterDatabase(id, {
    description: 'Every project the team is working on, who owns it and when it’s due.',
    properties: [
      k.title('Project'),
      k.status('status', 'Status', [
        ['Not started', 'default', 'todo'],
        ['In progress', 'blue', 'in_progress'],
        ['Done', 'green', 'complete'],
      ]),
      k.person('owner', 'Owner'),
      k.select('priority', 'Priority', [
        ['High', 'red'],
        ['Medium', 'yellow'],
        ['Low', 'gray'],
      ]),
      k.date('start', 'Start date'),
      k.date('due', 'Due date'),
      k.text('summary', 'Summary'),
    ],
    views: [
      {
        key: 'all',
        name: 'All projects',
        layout: 'table',
        show: ['status', 'owner', 'priority', 'start', 'due'],
        sorts: [['due', 'asc']],
      },
      {
        key: 'board',
        name: 'By status',
        layout: 'board',
        show: ['owner', 'due'],
        groupBy: 'status',
      },
      {
        key: 'timeline',
        name: 'Timeline',
        layout: 'timeline',
        show: ['owner'],
        dates: ['start', 'due'],
      },
    ],
    templates: [
      {
        key: 'project',
        name: 'New project',
        values: { status: status('Not started'), owner: [ME], start: k.day() },
        markdown: md('## Goal', '', '', '## Plan', '', '- [ ] ', '', '## Open questions', '', '- '),
      },
    ],
    defaultTemplate: 'project',
    rows: [
      {
        title: 'Refresh the refund macros',
        values: {
          status: status('In progress'),
          priority: priority('High'),
          start: k.day(-10),
          due: k.day(5),
          summary: k.rich('Rewrite the five refund macros so they match the new policy.'),
        },
      },
      {
        title: 'Route chats by language',
        values: {
          status: status('Not started'),
          priority: priority('Medium'),
          start: k.day(7),
          due: k.day(35),
          summary: k.rich('Send Spanish and French chats to the agents who speak them.'),
        },
      },
      {
        title: 'Fix help center search',
        values: {
          status: status('Done'),
          priority: priority('Low'),
          start: k.day(-40),
          due: k.day(-12),
          summary: k.rich('A search for “refund” now finds the refund policy first.'),
        },
      },
    ],
  });
};

/** Task board: the team's tasks on a board by status (the Feature list's Tasks). */
export const taskBoard: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const status = (name: string) => k.option('status', name);
  const priority = (name: string) => k.option('priority', name);
  return starterDatabase(id, {
    description: 'The team’s tasks, who’s on them and when they’re due.',
    properties: [
      k.title('Task'),
      k.status('status', 'Status', [
        ['Not started', 'default', 'todo'],
        ['In progress', 'blue', 'in_progress'],
        ['Done', 'green', 'complete'],
      ]),
      k.person('assignee', 'Assignee', true),
      k.date('due', 'Due'),
      k.select('priority', 'Priority', [
        ['High', 'red'],
        ['Medium', 'yellow'],
        ['Low', 'gray'],
      ]),
    ],
    views: [
      {
        key: 'board',
        name: 'Board',
        layout: 'board',
        show: ['assignee', 'due', 'priority'],
        groupBy: 'status',
      },
      {
        key: 'all',
        name: 'All tasks',
        layout: 'table',
        show: ['status', 'assignee', 'due', 'priority'],
        sorts: [['due', 'asc']],
      },
      {
        key: 'mine',
        name: 'My tasks',
        layout: 'table',
        show: ['status', 'due', 'priority'],
        where: [['assignee', 'contains_any', [ME]]],
        sorts: [['due', 'asc']],
      },
    ],
    templates: [
      { key: 'task', name: 'Task', values: { status: status('Not started') }, markdown: '' },
      {
        key: 'quick',
        name: 'Quick task for me',
        values: { status: status('Not started'), assignee: [ME], due: k.day(3) },
        markdown: '',
      },
    ],
    defaultTemplate: 'task',
    rows: [
      {
        title: 'Update the holiday hours banner',
        values: { status: status('Not started'), priority: priority('High'), due: k.day(2) },
      },
      {
        title: 'Review the new refund macro',
        values: { status: status('In progress'), priority: priority('Medium'), due: k.day(1) },
      },
      {
        title: 'Archive old saved replies',
        values: { status: status('Done'), priority: priority('Low'), due: k.day(-3) },
      },
    ],
  });
};

/** Content calendar: help center articles, newsletters and posts by publish date. */
export const contentCalendar: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const status = (name: string) => k.option('status', name);
  const channel = (name: string) => k.option('channel', name);
  return starterDatabase(id, {
    description: 'What the team publishes, where and when.',
    properties: [
      k.title('Title'),
      k.status('status', 'Status', [
        ['Idea', 'default', 'todo'],
        ['Writing', 'blue', 'in_progress'],
        ['Published', 'green', 'complete'],
      ]),
      k.select('channel', 'Channel', [
        ['Help center', 'blue'],
        ['Newsletter', 'purple'],
        ['Social', 'pink'],
      ]),
      k.date('publish', 'Publish date'),
      k.person('owner', 'Owner'),
      k.text('summary', 'Summary'),
    ],
    views: [
      {
        key: 'calendar',
        name: 'Calendar',
        layout: 'calendar',
        show: ['channel'],
        dates: ['publish'],
      },
      {
        key: 'all',
        name: 'All content',
        layout: 'table',
        show: ['status', 'channel', 'publish', 'owner'],
        sorts: [['publish', 'asc']],
      },
      {
        key: 'board',
        name: 'By status',
        layout: 'board',
        show: ['channel', 'publish'],
        groupBy: 'status',
      },
    ],
    templates: [
      {
        key: 'article',
        name: 'Help center article',
        values: { status: status('Idea'), channel: channel('Help center'), owner: [ME] },
        markdown: md(
          '## Who it’s for',
          '',
          '',
          '## Steps',
          '',
          '1. ',
          '',
          '## Related articles',
          '',
          '- ',
        ),
      },
    ],
    rows: [
      {
        title: 'How to reset your password',
        values: {
          status: status('Published'),
          channel: channel('Help center'),
          publish: k.day(-6),
        },
      },
      {
        title: 'Monthly product updates',
        values: { status: status('Writing'), channel: channel('Newsletter'), publish: k.day(4) },
      },
      {
        title: 'Holiday support hours',
        values: { status: status('Idea'), channel: channel('Social'), publish: k.day(12) },
      },
    ],
  });
};

/** Request form: access, equipment and schedule requests, answered in a database. */
export const requestForm: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const status = (name: string) => k.option('status', name);
  const type = (name: string) => k.option('type', name);
  return starterDatabase(id, {
    description: 'Requests sent with the form, and who’s handling them.',
    properties: [
      k.title('Request'),
      k.select('type', 'Type', [
        ['Access', 'blue'],
        ['Equipment', 'orange'],
        ['Schedule change', 'purple'],
        ['Other', 'gray'],
      ]),
      k.text('details', 'Details'),
      k.date('needed', 'Needed by'),
      k.createdBy('requester', 'Requested by'),
      k.status('status', 'Status', [
        ['New', 'default', 'todo'],
        ['In progress', 'blue', 'in_progress'],
        ['Done', 'green', 'complete'],
      ]),
      k.person('handler', 'Handled by'),
    ],
    views: [
      {
        key: 'form',
        name: 'Request form',
        layout: 'form',
        show: [],
        form: {
          title: 'Request form',
          description: 'Ask the team for access, equipment or a schedule change.',
          questions: [
            { key: 'name', text: 'What do you need?', required: true },
            { key: 'type', text: 'What kind of request is it?', required: true },
            { key: 'details', text: 'Tell us more', display: 'long' },
            { key: 'needed', text: 'When do you need it by?' },
          ],
          submitLabel: 'Send request',
          confirmation: 'Thanks! We’ll get back to you within one working day.',
        },
      },
      {
        key: 'all',
        name: 'All requests',
        layout: 'table',
        show: ['type', 'status', 'requester', 'needed', 'handler'],
        sorts: [['needed', 'asc']],
      },
      {
        key: 'board',
        name: 'By status',
        layout: 'board',
        show: ['type', 'needed'],
        groupBy: 'status',
      },
    ],
    rows: [
      {
        title: 'Access to the billing tool',
        values: {
          type: type('Access'),
          status: status('New'),
          needed: k.day(2),
          details: k.rich('I’m joining the billing queue next week.'),
        },
      },
      {
        title: 'A second monitor',
        values: { type: type('Equipment'), status: status('In progress'), needed: k.day(7) },
      },
      {
        title: 'Swap my Friday late shift',
        values: {
          type: type('Schedule change'),
          status: status('Done'),
          needed: k.day(-1),
          details: k.rich('Jordan Reyes agreed to take it.'),
        },
      },
    ],
  });
};

/** Feedback form: how things are going, collected in one place. */
export const feedbackForm: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const status = (name: string) => k.option('status', name);
  const topic = (name: string) => k.option('topic', name);
  const rating = (name: string) => k.option('rating', name);
  return starterDatabase(id, {
    description: 'Feedback from the team about tools, training and schedules.',
    properties: [
      k.title('Summary'),
      k.select('rating', 'Rating', [
        ['Very happy', 'green'],
        ['Happy', 'blue'],
        ['Not sure', 'yellow'],
        ['Unhappy', 'red'],
      ]),
      k.select('topic', 'Topic', [
        ['Tools', 'blue'],
        ['Training', 'green'],
        ['Schedules', 'purple'],
        ['Other', 'gray'],
      ]),
      k.text('details', 'Details'),
      k.checkbox('follow-up', 'Follow up'),
      k.createdBy('from', 'From'),
      k.status('status', 'Status', [
        ['New', 'default', 'todo'],
        ['Reviewing', 'blue', 'in_progress'],
        ['Done', 'green', 'complete'],
      ]),
    ],
    views: [
      {
        key: 'form',
        name: 'Feedback form',
        layout: 'form',
        show: [],
        form: {
          title: 'Feedback form',
          description: 'Tell us how our tools, training and schedules are working for you.',
          questions: [
            { key: 'rating', text: 'How happy are you overall?', required: true },
            { key: 'topic', text: 'What is it about?' },
            { key: 'name', text: 'Your feedback in a few words', required: true },
            { key: 'details', text: 'Tell us more', display: 'long' },
            { key: 'follow-up', text: 'May we follow up with you?' },
          ],
          submitLabel: 'Send feedback',
          confirmation: 'Thank you! The team reads every answer.',
        },
      },
      {
        key: 'all',
        name: 'All feedback',
        layout: 'table',
        show: ['rating', 'topic', 'status', 'from'],
      },
      { key: 'topics', name: 'By topic', layout: 'board', show: ['rating'], groupBy: 'topic' },
    ],
    rows: [
      {
        title: 'The new macro search is great',
        values: { rating: rating('Very happy'), topic: topic('Tools'), status: status('Done') },
      },
      {
        title: 'More practice before going live on chat',
        values: {
          rating: rating('Not sure'),
          topic: topic('Training'),
          status: status('Reviewing'),
          details: k.rich('Two practice shifts weren’t quite enough for me.'),
          'follow-up': true,
        },
      },
      {
        title: 'Late shift swaps are hard to arrange',
        values: { rating: rating('Unhappy'), topic: topic('Schedules'), status: status('New') },
      },
    ],
  });
};

/** Event sign-up: who's coming to a training day, by session. */
export const eventSignUp: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const session = (name: string) => k.option('session', name);
  const team = (name: string) => k.option('team', name);
  return starterDatabase(id, {
    description: 'Sign-ups for the team training day, by session.',
    properties: [
      k.title('Name'),
      k.select('team', 'Team', [
        ['Billing', 'blue'],
        ['Tech support', 'purple'],
        ['Accounts', 'green'],
      ]),
      k.select('session', 'Session', [
        ['Morning (9 AM)', 'yellow'],
        ['Afternoon (2 PM)', 'orange'],
      ]),
      k.text('dietary', 'Dietary needs'),
      k.text('questions', 'Questions for the speakers'),
      k.createdTime('signed-up', 'Signed up'),
    ],
    views: [
      {
        key: 'form',
        name: 'Sign-up form',
        layout: 'form',
        show: [],
        form: {
          title: 'Team training day',
          description: 'Save your seat, and pick the session that suits your shift.',
          questions: [
            { key: 'name', text: 'Your name', required: true },
            { key: 'team', text: 'Your team', required: true },
            { key: 'session', text: 'Which session will you join?', required: true },
            { key: 'dietary', text: 'Any dietary needs?' },
            {
              key: 'questions',
              text: 'Anything you’d like the speakers to cover?',
              display: 'long',
            },
          ],
          submitLabel: 'Sign up',
          confirmation: 'You’re on the list! We’ll send the agenda a week before.',
        },
      },
      {
        key: 'all',
        name: 'All sign-ups',
        layout: 'table',
        show: ['team', 'session', 'dietary', 'signed-up'],
      },
      { key: 'sessions', name: 'By session', layout: 'board', show: ['team'], groupBy: 'session' },
    ],
    rows: [
      {
        title: 'Avery Lin',
        values: { team: team('Billing'), session: session('Morning (9 AM)') },
      },
      {
        title: 'Jordan Reyes',
        values: {
          team: team('Tech support'),
          session: session('Afternoon (2 PM)'),
          dietary: k.rich('Vegetarian'),
        },
      },
      {
        title: 'Priya Nair',
        values: {
          team: team('Accounts'),
          session: session('Morning (9 AM)'),
          questions: k.rich('How do other teams handle refund escalations?'),
        },
      },
    ],
  });
};

// Customer Care starters (spec 3.1, TB-17), under Support.

/** Agents: everyone on the team, with their team, lead and status. */
export const agents: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const team = (name: string) => k.option('team', name);
  const status = (name: string) => k.option('status', name);
  return starterDatabase(id, {
    description: 'Everyone on the team: their team, team lead, start date and status.',
    properties: [
      k.title('Name'),
      k.person('person', 'Person'),
      k.select('team', 'Team', [
        ['Billing', 'blue'],
        ['Tech support', 'purple'],
        ['Accounts', 'green'],
      ]),
      k.person('lead', 'Team lead'),
      k.date('start', 'Start date'),
      k.select('status', 'Status', [
        ['Active', 'green'],
        ['On leave', 'yellow'],
        ['Left', 'gray'],
      ]),
    ],
    views: [
      {
        key: 'all',
        name: 'All agents',
        layout: 'table',
        show: ['person', 'team', 'lead', 'start', 'status'],
        sorts: [['name', 'asc']],
      },
      {
        key: 'teams',
        name: 'By team',
        layout: 'table',
        show: ['person', 'lead', 'start', 'status'],
        groupBy: 'team',
        sorts: [['name', 'asc']],
      },
    ],
    rows: [
      {
        title: 'Avery Lin',
        values: { team: team('Billing'), start: onDay('2024-03-04'), status: status('Active') },
      },
      {
        title: 'Jordan Reyes',
        values: {
          team: team('Tech support'),
          start: onDay('2025-01-13'),
          status: status('Active'),
        },
      },
      {
        title: 'Priya Nair',
        values: { team: team('Accounts'), start: onDay('2023-09-18'), status: status('On leave') },
      },
    ],
  });
};

/** QA reviews: scored conversations; agents see their own (Agent → Can view). */
export const qaReviews: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const channel = (name: string) => k.option('channel', name);
  const status = (name: string) => k.option('status', name);
  const shown = ['date', 'channel', 'score', 'status'];
  return starterDatabase(id, {
    description: 'Reviews of the team’s calls, chats and emails, with a score and notes.',
    properties: [
      k.title('Review'),
      k.person('agent', 'Agent'),
      k.person('reviewer', 'Reviewer'),
      k.person('lead', 'Team lead'),
      k.date('date', 'Date'),
      k.select('channel', 'Channel', [
        ['Phone', 'blue'],
        ['Chat', 'green'],
        ['Email', 'purple'],
      ]),
      { ...k.number('score', 'Score'), description: 'From 0 to 100.' },
      k.select('status', 'Status', [
        ['Draft', 'gray'],
        ['Shared', 'green'],
        ['Escalated', 'red'],
      ]),
      k.url('ticket', 'Ticket link'),
      k.text('notes', 'Notes'),
    ],
    views: [
      {
        key: 'all',
        name: 'All reviews',
        layout: 'table',
        show: ['agent', 'reviewer', ...shown],
        sorts: [['date', 'desc']],
      },
      {
        key: 'agents',
        name: 'By agent',
        layout: 'table',
        show: shown,
        groupBy: 'agent',
        sorts: [['date', 'desc']],
      },
      {
        key: 'mine',
        name: 'My reviews',
        layout: 'table',
        show: [...shown, 'ticket'],
        where: [['agent', 'contains_any', [ME]]],
        sorts: [['date', 'desc']],
      },
    ],
    // Changes nothing until a group is set to "Only rows they're in" (Databases 3.12).
    rules: [['agent', 'view']],
    rows: [
      {
        title: 'Chat 4821 · Refund request',
        values: {
          reviewer: [ME],
          date: k.day(-3),
          channel: channel('Chat'),
          score: '92',
          status: status('Shared'),
          ticket: 'https://tickets.example.com/4821',
          notes: k.rich('Clear steps and a friendly close. Next time, confirm the refund amount.'),
        },
      },
      {
        title: 'Call 4830 · Billing question',
        values: {
          reviewer: [ME],
          date: k.day(-1),
          channel: channel('Phone'),
          score: '78',
          status: status('Draft'),
          ticket: 'https://tickets.example.com/4830',
          notes: k.rich('Good questions up front. The hold was longer than it needed to be.'),
        },
      },
      {
        title: 'Email 4799 · Damaged order',
        values: {
          reviewer: [ME],
          date: k.day(-6),
          channel: channel('Email'),
          score: '64',
          status: status('Escalated'),
          ticket: 'https://tickets.example.com/4799',
          notes: k.rich('Promised a replacement before checking stock. Shared with the team lead.'),
        },
      },
    ],
  });
};

/** The headings every new coaching conversation starts with (TB-17). */
export const COACHING_HEADINGS = ['What went well', 'What to work on', 'Agreed actions'] as const;

/** Coaching conversations: planned and done, each starting with the same three headings. */
export const coachingConversations: StarterDatabaseBuild = (id) => {
  const k = starterKit(id);
  const focus = (name: string) => k.option('focus', name);
  const status = (name: string) => k.option('status', name);
  const notes = (well: string, work: string, actions: string) =>
    md(
      `## ${COACHING_HEADINGS[0]}`,
      '',
      `- ${well}`,
      '',
      `## ${COACHING_HEADINGS[1]}`,
      '',
      `- ${work}`,
      '',
      `## ${COACHING_HEADINGS[2]}`,
      '',
      `- [ ] ${actions}`,
    );
  return starterDatabase(id, {
    description: 'Coaching sessions with agents: what you talked about and what you agreed.',
    properties: [
      k.title('Conversation'),
      k.person('agent', 'Agent'),
      k.person('coach', 'Coach'),
      k.date('date', 'Date'),
      k.select('focus', 'Focus', [
        ['Empathy', 'pink'],
        ['Product knowledge', 'blue'],
        ['Accuracy', 'orange'],
        ['Efficiency', 'green'],
      ]),
      k.text('actions', 'Agreed actions'),
      k.date('follow-up', 'Follow-up date'),
      k.select('status', 'Status', [
        ['Planned', 'blue'],
        ['Done', 'green'],
      ]),
    ],
    views: [
      {
        key: 'upcoming',
        name: 'Upcoming',
        layout: 'table',
        show: ['agent', 'coach', 'date', 'focus', 'follow-up'],
        where: [['status', 'is', [status('Planned')]]],
        sorts: [['date', 'asc']],
      },
      {
        key: 'mine',
        name: 'My conversations',
        layout: 'table',
        show: ['agent', 'coach', 'date', 'focus', 'status'],
        where: [
          ['agent', 'contains_any', [ME]],
          ['coach', 'contains_any', [ME]],
        ],
        any: true,
        sorts: [['date', 'desc']],
      },
    ],
    templates: [
      {
        key: 'conversation',
        name: 'Coaching conversation',
        values: { coach: [ME], date: k.day(), status: status('Planned') },
        markdown: md(
          ...COACHING_HEADINGS.flatMap((heading, i) => [
            ...(i ? [''] : []),
            `## ${heading}`,
            '',
            '- ',
          ]),
        ),
      },
    ],
    defaultTemplate: 'conversation',
    rows: [
      {
        title: 'Avery Lin · Refund calls',
        values: {
          coach: [ME],
          date: k.day(2),
          focus: focus('Empathy'),
          'follow-up': k.day(16),
          status: status('Planned'),
        },
        markdown: notes(
          'Customers say Avery explains refunds clearly.',
          'Acknowledge the customer’s frustration before the steps.',
          'Listen back to two calls together',
        ),
      },
      {
        title: 'Jordan Reyes · First month on chat',
        values: {
          coach: [ME],
          date: k.day(-5),
          focus: focus('Product knowledge'),
          actions: k.rich('Use the billing macros for plan changes. Shadow two escalations.'),
          'follow-up': k.day(9),
          status: status('Done'),
        },
        markdown: notes(
          'Fast, friendly replies and a 96% satisfaction score.',
          'Plan changes and refunds on annual plans.',
          'Shadow two escalations with Priya Nair',
        ),
      },
      {
        title: 'Priya Nair · Back from leave',
        values: {
          coach: [ME],
          date: k.day(7),
          focus: focus('Accuracy'),
          'follow-up': k.day(21),
          status: status('Planned'),
        },
      },
    ],
  });
};
