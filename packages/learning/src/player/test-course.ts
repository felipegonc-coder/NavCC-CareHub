// Test data for the player tests (fictional). Not exported from the package.
import type { Course, RichText } from '../format/index';

/** Rich text with one plain paragraph per string. */
export const rt = (...paragraphs: string[]): RichText =>
  paragraphs.map((text) => ({ runs: [{ text }] }));

/** A small fictional help-desk course that uses most text-bearing block types. */
export const helpDesk: Course = {
  formatVersion: 1,
  id: 'c-help-desk',
  title: 'Welcome to the Bluebird help desk',
  type: 'standard',
  settings: {
    lessonOrder: 'sequential',
    completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: false },
    catalog: { listed: true },
    certificate: { enabled: false },
    sidebar: 'closed',
    labels: { next: '  Onwards ', continue: '   ' },
  },
  lessons: [
    {
      id: 'l-greet',
      kind: 'content',
      title: 'Greeting customers',
      icon: '👋',
      blocks: [
        { id: 'b-greet-h', type: 'heading', level: 2, text: 'First impressions' },
        {
          id: 'b-greet-p',
          type: 'paragraph',
          text: [
            {
              runs: [
                { text: 'Smile, say your name and ask how you can ' },
                { text: 'help', marks: ['bold'] },
                { text: ' today. See ' },
                {
                  text: 'Escalations',
                  link: { kind: 'lesson', lessonId: 'l-esc', blockId: 'b-esc-p' },
                },
                { text: ' for tricky calls.' },
              ],
            },
          ],
        },
        { id: 'b-greet-go', type: 'continue', requires: 'click', label: "I'm ready" },
        {
          id: 'b-greet-list',
          type: 'list',
          style: 'bulleted',
          items: [
            { id: 'i-name', text: rt('Use the name the customer prefers.') },
            { id: 'i-pace', text: rt('Match their pace.') },
          ],
        },
        {
          id: 'b-greet-quote',
          type: 'quote',
          text: 'Kindness is the fastest fix.',
          attribution: 'Rosa Delgado, team lead',
        },
        {
          id: 'b-greet-long',
          type: 'paragraph',
          text: rt(
            "Every call starts the same way, whatever the customer needs. Take a breath, check the account notes and listen to the whole question before you answer, because the first minute decides how the rest of the call feels for everyone involved. After the greeting, confirm the account holder's name and the reason for the call, then sum up what you heard in one sentence.",
          ),
        },
        { id: 'b-greet-code', type: 'code', language: 'text', code: 'GREETING_SCRIPT_V2' },
      ],
    },
    {
      id: 'l-refunds',
      kind: 'content',
      title: 'Résumé of the refund policy',
      blocks: [
        {
          id: 'b-ref-tip',
          type: 'callout',
          tone: 'tip',
          title: 'Refund window',
          text: rt('Refunds are possible within 30 days of purchase.'),
        },
        {
          id: 'b-ref-table',
          type: 'table',
          headerRow: true,
          rows: [
            ['Plan', 'Refund'],
            ['Starter', 'Full'],
            ['Premium', 'Pro-rated'],
          ],
        },
        {
          id: 'b-ref-video',
          type: 'video',
          media: { kind: 'url', url: 'https://video.example.com/refunds' },
          title: 'Refunds in two minutes',
          transcript: rt("Hello, I'm Theo from Billing. Let's walk through a credit note."),
        },
        {
          id: 'b-ref-image',
          type: 'image',
          size: 'medium',
          image: {
            media: { kind: 'file', fileId: 'f-refund-form' },
            alt: 'The refund form on screen',
            caption: 'Step 1: open the form',
          },
        },
        {
          id: 'b-ref-deco',
          type: 'image',
          size: 'small',
          image: {
            media: { kind: 'file', fileId: 'f-pattern' },
            alt: 'Ornamental swirl',
            decorative: true,
          },
        },
        {
          id: 'b-ref-check',
          type: 'knowledge_check',
          allowRetry: true,
          question: {
            id: 'q-window',
            type: 'single_choice',
            prompt: rt('How long is the refund window?'),
            points: 1,
            options: [
              { id: 'o-30', text: 'Within 30 days', correct: true, feedback: rt('Right, zebra.') },
              { id: 'o-never', text: 'Never', correct: false },
            ],
            feedback: { correct: rt('Well done, okapi.') },
          },
        },
        {
          id: 'b-ref-blank',
          type: 'knowledge_check',
          allowRetry: false,
          question: {
            id: 'q-blank',
            type: 'fill_blank',
            prompt: rt('Fill in the gap.'),
            points: 1,
            parts: [
              { kind: 'text', text: 'A refund needs a signed ' },
              { kind: 'blank', id: 'k-1', answers: ['pelican slip'] },
            ],
          },
        },
        {
          id: 'b-ref-scenario',
          type: 'scenario',
          title: 'An upset caller',
          characters: [{ id: 'ch-dana', name: 'Dana Whitfield', role: 'Customer' }],
          startSceneId: 's-1',
          scenes: [
            {
              id: 's-1',
              speakerId: 'ch-dana',
              text: 'I want my money back, giraffe!',
              choices: [
                {
                  id: 'c-1',
                  text: 'Offer a flamingo voucher',
                  points: 1,
                  next: { kind: 'scene', sceneId: 's-2' },
                },
              ],
            },
            {
              id: 's-2',
              text: 'Thanks.',
              choices: [],
              ending: { outcome: 'great', title: 'Happy customer' },
            },
          ],
        },
      ],
    },
    {
      id: 'l-esc',
      kind: 'content',
      title: 'Escalations',
      minimumSeconds: 60,
      blocks: [
        {
          id: 'b-esc-p',
          type: 'paragraph',
          text: rt('Escalate to a team lead when a customer asks twice.'),
        },
        { id: 'b-esc-statement', type: 'statement', text: "Never promise what you can't deliver." },
        {
          id: 'b-esc-cols',
          type: 'two_column',
          left: rt('Billing questions'),
          right: rt('Technical questions'),
        },
        {
          id: 'b-esc-quotes',
          type: 'quote_carousel',
          quotes: [
            { id: 'qt-1', text: 'Escalating early saved the day.', attribution: 'Sam Okafor' },
            { id: 'qt-2', text: 'Write good notes.' },
          ],
        },
        { id: 'b-esc-line', type: 'divider', style: 'numbered' },
        {
          id: 'b-esc-button',
          type: 'button',
          label: 'Open the refund lesson',
          target: { kind: 'lesson', lessonId: 'l-refunds' },
        },
      ],
    },
    {
      id: 'l-quiz',
      kind: 'quiz',
      title: 'Check your knowledge',
      intro: rt('Five questions about refunds and escalations.'),
      settings: {
        passMark: 80,
        maxAttempts: null,
        shuffleQuestions: false,
        shuffleOptions: false,
        revealAnswers: 'after_each_attempt',
      },
      questions: [
        {
          id: 'q-late',
          type: 'true_false',
          prompt: rt('A walrus refund after 90 days is fine.'),
          points: 1,
          answer: false,
        },
      ],
    },
  ],
};
