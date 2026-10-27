import type { Course } from '../format/index';
import { richText } from '../format/index';
import { file, frozen, picture } from './shared';

/** Every block type (28) and every question type (8) once, all publishable. For players, editors and screenshots. */
export const sampleShowcaseCourse: Course = frozen({
  formatVersion: 1,
  id: 'course-showcase',
  title: 'Everything a course can hold',
  summary: 'A tour of every block and question type.',
  description: richText('Use this course to see how each block looks and behaves.'),
  cover: picture('sample-cover-3', 'Colourful building blocks on a desk'),
  coverLayout: 'split',
  type: 'standard',
  topics: ['Examples'],
  estimatedMinutes: 30,
  settings: {
    lessonOrder: 'free',
    completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: false },
    catalog: { listed: false },
    certificate: { enabled: false },
    sidebar: 'open',
    labels: { start: 'Start the tour', next: 'Next stop' },
  },
  lessons: [
    {
      id: 'show-text',
      kind: 'content',
      title: 'Text blocks',
      icon: '📝',
      headerImage: { ...picture('sample-header-1', ''), decorative: true },
      blocks: [
        { id: 'show-heading', type: 'heading', level: 2, text: 'Text blocks' },
        {
          id: 'show-paragraph',
          type: 'paragraph',
          text: richText(
            [
              { text: 'Text can be ' },
              { text: 'bold', marks: ['bold'] },
              { text: ', ' },
              { text: 'linked', link: { kind: 'url', url: 'https://help.example.org/style' } },
              { text: ' or point to ' },
              {
                text: 'another lesson',
                link: { kind: 'lesson', lessonId: 'show-media', blockId: 'show-video' },
              },
              { text: '.' },
            ],
            'A second paragraph.\nWith a line break.',
          ),
        },
        {
          id: 'show-list',
          type: 'list',
          style: 'checkbox',
          items: [
            { id: 'show-list-1', text: richText('Read the lesson') },
            { id: 'show-list-2', text: richText('Try the activities') },
          ],
        },
        {
          id: 'show-callout',
          type: 'callout',
          tone: 'warning',
          title: 'Heads up',
          text: richText('Callouts come in four tones.'),
        },
        {
          id: 'show-statement',
          type: 'statement',
          text: 'A statement stands out from the text around it.',
        },
        {
          id: 'show-quote',
          type: 'quote',
          text: 'Good support is a conversation.',
          attribution: 'Morgan Ellis',
          background: { ...picture('sample-image-sky', ''), decorative: true },
        },
        {
          id: 'show-quotes',
          type: 'quote_carousel',
          quotes: [
            {
              id: 'show-quote-1',
              text: 'They called me back the same day.',
              attribution: 'A fictional member',
            },
            {
              id: 'show-quote-2',
              text: 'Clear and kind.',
              attribution: 'Another fictional member',
            },
          ],
        },
        {
          id: 'show-columns',
          type: 'two_column',
          left: richText('Left column'),
          right: richText('Right column'),
        },
        { id: 'show-divider', type: 'divider', style: 'numbered' },
        {
          id: 'show-code',
          type: 'code',
          language: 'text',
          code: 'Ticket BS-1024: call back before 3 pm',
        },
        {
          id: 'show-table',
          type: 'table',
          headerRow: true,
          rows: [
            ['Channel', 'Reply within'],
            ['Phone', 'Right away'],
            ['Email', 'One working day'],
          ],
        },
      ],
    },
    {
      id: 'show-media',
      kind: 'content',
      title: 'Media blocks',
      icon: '🎬',
      blocks: [
        {
          id: 'show-image',
          type: 'image',
          image: {
            ...picture('sample-image-team', 'Four colleagues around a table'),
            decorative: false,
          },
          size: 'full',
          layout: 'image_and_text',
          text: richText('The team at the weekly huddle.'),
        },
        {
          id: 'show-gallery',
          type: 'gallery',
          layout: 'carousel',
          images: [
            picture('sample-image-desk', 'A tidy desk'),
            picture(
              'sample-image-headset',
              'A headset on a stand',
              'Headsets live in the cupboard',
            ),
          ],
        },
        {
          id: 'show-graphic',
          type: 'labeled_graphic',
          image: picture('sample-image-screen', 'The ticket screen'),
          markers: [
            {
              id: 'show-marker-search',
              x: 10,
              y: 8,
              title: 'Search',
              text: richText('Find a member by name or number.'),
            },
            {
              id: 'show-marker-notes',
              x: 60,
              y: 50,
              title: 'Notes',
              text: richText('Read the latest notes first.'),
            },
          ],
        },
        {
          id: 'show-video',
          type: 'video',
          media: file('sample-video-1'),
          title: 'A two-minute welcome',
          captions: [
            { fileId: 'sample-captions-en', language: 'en', label: 'English' },
            { fileId: 'sample-captions-es', language: 'es', label: 'Español' },
          ],
          transcript: richText('Hello and welcome to the team.'),
        },
        {
          id: 'show-audio',
          type: 'audio',
          media: { kind: 'url', url: 'https://media.example.org/sample-call.mp3' },
          title: 'A sample call',
          transcript: richText('Thanks for calling.'),
        },
        {
          id: 'show-file',
          type: 'file',
          fileId: 'sample-file-1',
          name: 'Call checklist.pdf',
          description: 'One page; print it for your desk.',
        },
        {
          id: 'show-embed',
          type: 'embed',
          url: 'https://forms.example.org/feedback',
          title: 'Feedback form',
          height: 480,
        },
      ],
    },
    {
      id: 'show-interactive',
      kind: 'content',
      title: 'Interactive blocks',
      icon: '🧩',
      blocks: [
        {
          id: 'show-accordion',
          type: 'accordion',
          items: [
            { id: 'show-acc-1', title: 'First question', body: richText('First answer.') },
            { id: 'show-acc-2', title: 'Second question', body: richText('Second answer.') },
          ],
        },
        {
          id: 'show-tabs',
          type: 'tabs',
          tabs: [
            { id: 'show-tab-phone', title: 'Phone', body: richText('Answer within three rings.') },
            { id: 'show-tab-chat', title: 'Chat', body: richText('Reply within two minutes.') },
          ],
        },
        {
          id: 'show-timeline',
          type: 'timeline',
          items: [
            { id: 'show-day-1', label: 'Day 1', title: 'Shadow a colleague' },
            {
              id: 'show-day-2',
              label: 'Day 2',
              title: 'Take calls with a buddy',
              body: richText('Your buddy listens in.'),
            },
          ],
        },
        {
          id: 'show-process',
          type: 'process',
          intro: { title: 'Three steps', body: richText('Every call, every time.') },
          steps: [
            {
              id: 'show-step-1',
              title: 'Greet',
              body: richText("Your name and the team's name."),
              image: picture('sample-image-wave', 'A hand waving'),
            },
            { id: 'show-step-2', title: 'Listen', body: richText('Let them finish.') },
            { id: 'show-step-3', title: 'Close', body: richText('Say what happens next.') },
          ],
          summary: { title: "That's it" },
        },
        {
          id: 'show-cards',
          type: 'flashcards',
          cards: [
            { id: 'show-card-1', front: 'SLA', back: 'Service level agreement' },
            {
              id: 'show-card-2',
              front: '',
              back: 'A headset',
              frontImage: picture('sample-image-headset', 'A headset'),
            },
          ],
        },
        {
          id: 'show-sorting',
          type: 'sorting',
          categories: [
            { id: 'today', title: 'Same day' },
            { id: 'later', title: 'Can wait' },
          ],
          items: [
            { id: 'show-sort-1', text: 'Locked out before an appointment', categoryId: 'today' },
            { id: 'show-sort-2', text: 'Wants a printed brochure', categoryId: 'later' },
          ],
        },
        {
          id: 'show-button',
          type: 'button',
          label: 'Open the handbook',
          description: 'Opens the team handbook page.',
          target: { kind: 'page', pageId: 'sample-page-handbook' },
        },
        {
          id: 'show-continue',
          type: 'continue',
          label: "I've tried them",
          requires: 'complete_above',
        },
        {
          id: 'show-check',
          type: 'knowledge_check',
          allowRetry: false,
          question: {
            id: 'show-check-q',
            type: 'true_false',
            prompt: richText('Knowledge checks never count towards the score.'),
            points: 1,
            answer: true,
            feedbackTrue: richText('Right.'),
            feedbackFalse: richText("They're for practice only."),
          },
        },
        {
          id: 'show-scenario',
          type: 'scenario',
          title: 'A quick decision',
          intro: richText('Riley needs an answer fast.'),
          characters: [{ id: 'riley', name: 'Riley Brooks', role: 'Member' }],
          startSceneId: 'ask',
          scenes: [
            {
              id: 'ask',
              speakerId: 'riley',
              text: 'Can you move my appointment to tomorrow?',
              choices: [
                {
                  id: 'check',
                  text: "Let me check what's free.",
                  points: 5,
                  next: { kind: 'scene', sceneId: 'done' },
                },
                {
                  id: 'no',
                  text: "That's not possible.",
                  points: -5,
                  coaching: richText('Check before you say no.'),
                  next: { kind: 'retry' },
                },
                {
                  id: 'learn',
                  text: 'Read the booking lesson first',
                  points: 0,
                  next: { kind: 'lesson', lessonId: 'show-text' },
                },
              ],
            },
            {
              id: 'done',
              text: 'Riley gets a slot tomorrow morning.',
              choices: [],
              ending: { outcome: 'great', title: 'Sorted' },
            },
          ],
          passScore: 5,
        },
      ],
    },
    {
      id: 'show-quiz',
      kind: 'quiz',
      title: 'Every question type',
      intro: richText('One question of each type.'),
      settings: {
        passMark: 75,
        maxAttempts: 5,
        shuffleQuestions: false,
        shuffleOptions: true,
        poolSize: 8,
        revealAnswers: 'after_each_attempt',
        mode: 'graded',
      },
      questions: [
        {
          id: 'show-q-single',
          type: 'single_choice',
          prompt: richText('Pick the friendliest greeting.'),
          points: 1,
          options: [
            {
              id: 'a',
              text: 'Hi, this is Sam. How can I help?',
              correct: true,
              feedback: richText('Warm and clear.'),
            },
            { id: 'b', text: 'Yes?', correct: false, feedback: richText('Too short.') },
          ],
        },
        {
          id: 'show-q-multiple',
          type: 'multiple_choice',
          prompt: richText('Which channels does the team answer?'),
          image: picture('sample-image-channels', 'Icons for phone, chat and email'),
          points: 2,
          options: [
            { id: 'phone', text: 'Phone', correct: true },
            { id: 'chat', text: 'Chat', correct: true },
            { id: 'fax', text: 'Fax', correct: false },
          ],
        },
        {
          id: 'show-q-tf',
          type: 'true_false',
          prompt: richText('You can put a member on hold without asking.'),
          points: 1,
          answer: false,
        },
        {
          id: 'show-q-matching',
          type: 'matching',
          prompt: richText('Match the term to its meaning.'),
          points: 2,
          pairs: [
            { id: 'sla', prompt: 'SLA', match: 'Service level agreement' },
            { id: 'csat', prompt: 'CSAT', match: 'Customer satisfaction score' },
          ],
        },
        {
          id: 'show-q-drag',
          type: 'drag_matching',
          prompt: richText('Drag each channel to its reply time.'),
          points: 2,
          pairs: [
            { id: 'phone', prompt: 'Phone', match: 'Right away' },
            { id: 'email', prompt: 'Email', match: 'One working day' },
          ],
        },
        {
          id: 'show-q-fill',
          type: 'fill_blank',
          prompt: richText('Fill in the blank.'),
          points: 1,
          parts: [
            { kind: 'text', text: 'Call back within ' },
            { kind: 'blank', id: 'hours', answers: ['24', 'twenty-four'] },
            { kind: 'text', text: ' hours.' },
          ],
        },
        {
          id: 'show-q-order',
          type: 'ordering',
          prompt: richText('Put the steps in order.'),
          points: 1,
          items: [
            { id: 'greet', text: 'Greet' },
            { id: 'listen', text: 'Listen' },
            { id: 'close', text: 'Close' },
          ],
        },
        {
          id: 'show-q-hotspot',
          type: 'hotspot',
          prompt: richText('Select the mute button.'),
          points: 1,
          image: picture('sample-image-phone', 'A desk phone'),
          spots: [
            {
              id: 'mute',
              shape: 'ellipse',
              x: 10,
              y: 70,
              width: 12,
              height: 12,
              correct: true,
              label: 'Mute button',
            },
            {
              id: 'hangup',
              shape: 'ellipse',
              x: 75,
              y: 70,
              width: 12,
              height: 12,
              correct: false,
              label: 'Hang-up button',
            },
          ],
        },
      ],
    },
  ],
});
