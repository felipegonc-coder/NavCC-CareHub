import type { Course, CourseSettings, QuizSettings } from '../format/index';
import { richText } from '../format/index';
import { frozen, picture } from './shared';

// Fictional courses for a made-up support team ("Brightside Support"). Every course here passes
// checkPublishable; tests copy them and break one thing at a time.

const listed = {
  catalog: { listed: true },
  certificate: { enabled: false },
} satisfies Partial<CourseSettings>;

const graded = (passMark: number, more: Partial<QuizSettings> = {}): QuizSettings => ({
  passMark,
  maxAttempts: null,
  shuffleQuestions: false,
  shuffleOptions: false,
  revealAnswers: 'after_each_attempt',
  ...more,
});

/** Standard course, the same shape as the Phase 1 test: 3 lessons (60 s minimum on the first), a knowledge check, then a 5-question final quiz. */
export const sampleStandardCourse: Course = frozen({
  formatVersion: 1,
  id: 'course-calls-with-care',
  title: 'Handling calls with care',
  summary: 'Greet, listen and close every call so the member knows what happens next.',
  description: richText('Three short lessons and a final quiz. About 20 minutes.'),
  cover: picture('sample-cover-1', 'A support agent smiling while talking on a headset'),
  type: 'standard',
  topics: ['Phones', 'Onboarding'],
  estimatedMinutes: 20,
  settings: {
    lessonOrder: 'free',
    completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: false },
    ...listed,
  },
  lessons: [
    {
      id: 'calls-before',
      kind: 'content',
      title: 'Before the call',
      minimumSeconds: 60,
      blocks: [
        { id: 'calls-before-heading', type: 'heading', level: 1, text: 'Get ready in one minute' },
        {
          id: 'calls-before-text',
          type: 'paragraph',
          text: richText("Open the member's record, check recent notes and take a breath."),
        },
        {
          id: 'calls-before-tip',
          type: 'callout',
          tone: 'tip',
          title: 'Tip',
          text: richText('Keep a glass of water at your desk.'),
        },
        {
          id: 'calls-before-desk',
          type: 'image',
          image: picture('sample-image-desk', 'A tidy desk with a headset and a notepad'),
          size: 'medium',
        },
        { id: 'calls-before-continue', type: 'continue', requires: 'click' },
        {
          id: 'calls-before-ready',
          type: 'statement',
          text: 'Ready means record open, notes read, headset on.',
        },
      ],
    },
    {
      id: 'calls-during',
      kind: 'content',
      title: 'During the call',
      blocks: [
        {
          id: 'calls-during-intro',
          type: 'paragraph',
          text: richText('Every call follows the same three steps.'),
        },
        {
          id: 'calls-during-steps',
          type: 'list',
          style: 'numbered',
          items: [
            { id: 'step-greet', text: richText("Greet: your name and the team's name.") },
            {
              id: 'step-listen',
              text: richText('Listen: let the member finish before you answer.'),
            },
            { id: 'step-close', text: richText('Close: say what happens next and when.') },
          ],
        },
        {
          id: 'calls-during-check',
          type: 'knowledge_check',
          allowRetry: true,
          question: {
            id: 'calls-check-greeting',
            type: 'single_choice',
            prompt: richText('Which greeting follows the guide?'),
            points: 1,
            options: [
              {
                id: 'greet-full',
                text: 'Hi, this is Sam from Brightside Support. How can I help?',
                correct: true,
              },
              {
                id: 'greet-short',
                text: 'Support, go ahead.',
                correct: false,
                feedback: richText("Say your name and the team's name."),
              },
            ],
          },
        },
        {
          id: 'calls-during-faq',
          type: 'accordion',
          items: [
            {
              id: 'faq-drop',
              title: 'What if the line drops?',
              body: richText('Call back once, then send a message.'),
            },
            {
              id: 'faq-angry',
              title: 'What if the member is upset?',
              body: richText('Acknowledge the feeling before the facts.'),
            },
          ],
        },
      ],
    },
    {
      id: 'calls-after',
      kind: 'content',
      title: 'After the call',
      blocks: [
        {
          id: 'calls-after-intro',
          type: 'paragraph',
          text: richText('Write your note while the call is fresh, before you take the next one.'),
        },
        {
          id: 'calls-after-note',
          type: 'callout',
          tone: 'note',
          title: 'A good note says',
          text: richText('What the member asked, what you did and what happens next.'),
        },
        {
          id: 'calls-after-rule',
          type: 'statement',
          text: "If it isn't in the notes, the next person can't help.",
        },
      ],
    },
    {
      id: 'calls-quiz',
      kind: 'quiz',
      title: 'Final quiz',
      intro: richText('Five questions. You need 80 % to pass and can try as often as you like.'),
      settings: graded(80),
      questions: [
        {
          id: 'calls-q-first',
          type: 'single_choice',
          prompt: richText('What do you open before taking a call?'),
          points: 1,
          options: [
            { id: 'record', text: "The member's record", correct: true },
            { id: 'email', text: 'Your email', correct: false },
            { id: 'news', text: 'The news', correct: false },
          ],
        },
        {
          id: 'calls-q-close',
          type: 'multiple_choice',
          prompt: richText('What belongs in a good close?'),
          points: 2,
          options: [
            { id: 'next', text: 'What happens next', correct: true },
            { id: 'when', text: 'When it will happen', correct: true },
            { id: 'joke', text: 'A joke', correct: false },
          ],
        },
        {
          id: 'calls-q-interrupt',
          type: 'true_false',
          prompt: richText("You should finish the member's sentences to save time."),
          points: 1,
          answer: false,
          feedback: {
            correct: richText('Right: let them finish.'),
            incorrect: richText('Let the member finish first.'),
          },
        },
        {
          id: 'calls-q-terms',
          type: 'matching',
          prompt: richText('Match each step to what you do.'),
          points: 3,
          pairs: [
            { id: 'pair-greet', prompt: 'Greet', match: "Say your name and the team's name" },
            { id: 'pair-listen', prompt: 'Listen', match: 'Let the member finish' },
            { id: 'pair-close', prompt: 'Close', match: 'Say what happens next' },
          ],
        },
        {
          id: 'calls-q-order',
          type: 'ordering',
          prompt: richText('Put the steps of a call in order.'),
          points: 2,
          items: [
            { id: 'order-greet', text: 'Greet' },
            { id: 'order-listen', text: 'Listen' },
            { id: 'order-close', text: 'Close' },
          ],
        },
      ],
    },
  ],
});

/** Scenario lab: practise a hard conversation with branching choices. */
export const sampleScenarioLabCourse: Course = frozen({
  formatVersion: 1,
  id: 'course-upset-member',
  title: 'Practice: an upset member',
  summary: 'Try different replies to a frustrated member and see where they lead.',
  type: 'scenario_lab',
  estimatedMinutes: 10,
  settings: {
    lessonOrder: 'free',
    completion: { requireAllLessons: true, requireQuizPass: false, requireAcknowledgement: false },
    ...listed,
  },
  lessons: [
    {
      id: 'upset-practice',
      kind: 'content',
      title: 'The late reply',
      blocks: [
        {
          id: 'upset-intro',
          type: 'paragraph',
          text: richText('Jordan has waited a week for an answer. Choose your replies.'),
        },
        {
          id: 'upset-scenario',
          type: 'scenario',
          title: 'Jordan calls back',
          characters: [
            {
              id: 'jordan',
              name: 'Jordan Avery',
              role: 'Member',
              avatar: picture('sample-avatar-jordan', 'Illustration of Jordan'),
            },
          ],
          startSceneId: 'opening',
          passScore: 10,
          scenes: [
            {
              id: 'opening',
              speakerId: 'jordan',
              text: "I've been waiting a whole week. Nobody calls me back!",
              choices: [
                {
                  id: 'acknowledge',
                  text: "I'm sorry you've waited. Let's sort it out now.",
                  points: 10,
                  next: { kind: 'scene', sceneId: 'calmer' },
                },
                {
                  id: 'policy',
                  text: 'Replies can take up to ten days.',
                  points: -5,
                  coaching: richText('True, but it sounds like an excuse.'),
                  next: { kind: 'scene', sceneId: 'angrier' },
                },
              ],
            },
            {
              id: 'angrier',
              speakerId: 'jordan',
              text: "So I'm supposed to just wait?",
              choices: [
                {
                  id: 'recover',
                  text: "No. I'll look at it with you right now.",
                  points: 5,
                  next: { kind: 'scene', sceneId: 'calmer' },
                },
                { id: 'again', text: 'Start again', points: 0, next: { kind: 'retry' } },
              ],
            },
            {
              id: 'calmer',
              speakerId: 'jordan',
              text: 'Okay. Thank you for actually listening.',
              choices: [],
              ending: {
                outcome: 'great',
                title: 'Back on track',
                text: richText('Acknowledging the wait first calmed things down.'),
              },
            },
          ],
        },
        {
          id: 'upset-reflect',
          type: 'callout',
          tone: 'note',
          text: richText('Which reply would you use on your next call?'),
        },
      ],
    },
  ],
});

/** Required read: a policy everyone acknowledges, with a short quiz that needs 100 %. */
export const sampleRequiredReadCourse: Course = frozen({
  formatVersion: 1,
  id: 'course-privacy-basics',
  title: 'Privacy basics',
  summary: "What you may share, with whom, and how to check who you're talking to.",
  type: 'required_read',
  estimatedMinutes: 15,
  settings: {
    lessonOrder: 'sequential',
    completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: true },
    acknowledgement: { statement: 'I have read the privacy basics and will follow them.' },
    catalog: { listed: false },
    certificate: { enabled: false },
    reviewEveryMonths: 12,
  },
  lessons: [
    {
      id: 'privacy-rules',
      kind: 'content',
      title: 'The three rules',
      blocks: [
        {
          id: 'privacy-statement',
          type: 'statement',
          text: "Check who you're talking to before you share anything.",
        },
        {
          id: 'privacy-columns',
          type: 'two_column',
          left: richText('Share with: the member, or someone with consent on file.'),
          right: richText('Never share with: neighbours, employers or anyone without consent.'),
        },
        {
          id: 'privacy-quote',
          type: 'quote',
          text: "If in doubt, don't share it out.",
          attribution: 'Priya Raman, privacy lead',
        },
      ],
    },
    {
      id: 'privacy-quiz',
      kind: 'quiz',
      title: 'Check your understanding',
      settings: graded(100, { revealAnswers: 'after_passing' }),
      questions: [
        {
          id: 'privacy-q-neighbour',
          type: 'true_false',
          prompt: richText("You may tell a member's neighbour that the member called."),
          points: 1,
          answer: false,
        },
        {
          id: 'privacy-q-check',
          type: 'multiple_choice',
          prompt: richText("Which details confirm who you're talking to?"),
          points: 1,
          options: [
            { id: 'dob', text: 'Date of birth', correct: true },
            { id: 'postcode', text: 'Postcode', correct: true },
            { id: 'colour', text: 'Favourite colour', correct: false },
          ],
        },
        {
          id: 'privacy-q-blank',
          type: 'fill_blank',
          prompt: richText('Complete the rule.'),
          points: 1,
          parts: [
            { kind: 'text', text: 'Only share with someone who has ' },
            { kind: 'blank', id: 'consent', answers: ['consent', 'consent on file'] },
            { kind: 'text', text: ' on file.' },
          ],
        },
      ],
    },
  ],
});

/** Microlearning: one short lesson, no quiz. */
export const sampleMicrolearningCourse: Course = frozen({
  formatVersion: 1,
  id: 'course-two-minute-hold',
  title: 'Two-minute tip: putting a call on hold',
  type: 'microlearning',
  estimatedMinutes: 2,
  settings: {
    lessonOrder: 'free',
    completion: { requireAllLessons: true, requireQuizPass: false, requireAcknowledgement: false },
    ...listed,
  },
  lessons: [
    {
      id: 'hold-lesson',
      kind: 'content',
      title: 'Two-minute tip: putting a call on hold',
      icon: '⏸️',
      blocks: [
        { id: 'hold-ask', type: 'statement', text: 'Always ask before you put someone on hold.' },
        {
          id: 'hold-cards',
          type: 'flashcards',
          cards: [
            {
              id: 'card-ask',
              front: 'Before the hold',
              back: '"May I put you on hold for two minutes?"',
            },
            { id: 'card-back', front: 'After the hold', back: '"Thanks for waiting."' },
          ],
        },
      ],
    },
  ],
});

/** Certification: sequential, 90 % with 3 tries, a bank draw, a feedback survey and a 12-month certificate. */
export const sampleCertificationCourse: Course = frozen({
  formatVersion: 1,
  id: 'course-escalations-cert',
  title: 'Escalations certification',
  summary: 'Prove you can route urgent requests to the right team.',
  cover: picture('sample-cover-2', 'A flow chart of escalation routes'),
  coverLayout: 'full',
  type: 'certification',
  estimatedMinutes: 45,
  settings: {
    lessonOrder: 'sequential',
    completion: { requireAllLessons: true, requireQuizPass: true, requireAcknowledgement: false },
    minimumCourseSeconds: 600,
    catalog: { listed: true },
    certificate: { enabled: true, validForMonths: 12 },
    sidebar: 'closed',
    labels: { submit: 'Submit answers' },
    reviewEveryMonths: 6,
  },
  lessons: [
    {
      id: 'esc-routes',
      kind: 'content',
      title: 'Escalations',
      blocks: [
        {
          id: 'esc-process',
          type: 'process',
          intro: { title: 'Where does it go?' },
          steps: [
            {
              id: 'esc-step-urgent',
              title: 'Is it urgent?',
              body: richText('Same-day problems go to the duty lead.'),
            },
            {
              id: 'esc-step-billing',
              title: 'Is it about money?',
              body: richText('Billing questions go to the billing team.'),
            },
            {
              id: 'esc-step-other',
              title: 'Everything else',
              body: richText('Log it and reply within one working day.'),
            },
          ],
        },
        {
          id: 'esc-sorting',
          type: 'sorting',
          categories: [
            { id: 'duty', title: 'Duty lead' },
            { id: 'billing', title: 'Billing team' },
          ],
          items: [
            {
              id: 'sort-locked',
              text: 'Locked out of the member portal before an appointment',
              categoryId: 'duty',
            },
            { id: 'sort-refund', text: 'Asking about a refund', categoryId: 'billing' },
            { id: 'sort-charge', text: 'Charged twice this month', categoryId: 'billing' },
          ],
        },
      ],
    },
    {
      id: 'esc-exam',
      kind: 'quiz',
      title: 'Certification exam',
      settings: graded(90, {
        maxAttempts: 3,
        shuffleQuestions: true,
        shuffleOptions: true,
        revealAnswers: 'after_final_attempt',
      }),
      questions: [
        {
          id: 'esc-q-urgent',
          type: 'single_choice',
          prompt: richText(
            'A member is locked out an hour before an appointment. Who do you call?',
          ),
          points: 1,
          options: [
            { id: 'duty', text: 'The duty lead', correct: true },
            { id: 'billing', text: 'The billing team', correct: false },
          ],
        },
        {
          id: 'esc-q-route',
          type: 'drag_matching',
          prompt: richText('Drag each request to the team that handles it.'),
          points: 2,
          pairs: [
            { id: 'route-refund', prompt: 'Refund', match: 'Billing team' },
            { id: 'route-lockout', prompt: 'Lockout before an appointment', match: 'Duty lead' },
          ],
        },
        {
          id: 'esc-q-hotspot',
          type: 'hotspot',
          prompt: richText('Select the escalate button.'),
          points: 1,
          image: picture('sample-screen-ticket', 'A ticket screen with buttons along the top'),
          spots: [
            {
              id: 'spot-escalate',
              shape: 'rect',
              x: 70,
              y: 5,
              width: 20,
              height: 8,
              correct: true,
              label: 'Escalate button',
            },
            {
              id: 'spot-close',
              shape: 'rect',
              x: 45,
              y: 5,
              width: 20,
              height: 8,
              correct: false,
              label: 'Close ticket button',
            },
          ],
        },
      ],
      bankDraws: [
        {
          bankId: 'bank-escalations',
          count: 2,
          questions: [
            {
              id: 'bank-esc-1',
              type: 'true_false',
              prompt: richText('Billing questions go to the duty lead.'),
              points: 1,
              answer: false,
            },
            {
              id: 'bank-esc-2',
              type: 'true_false',
              prompt: richText('Non-urgent requests get a reply within one working day.'),
              points: 1,
              answer: true,
            },
            {
              id: 'bank-esc-3',
              type: 'single_choice',
              prompt: richText('Who handles a double charge?'),
              points: 1,
              options: [
                { id: 'billing', text: 'The billing team', correct: true },
                { id: 'duty', text: 'The duty lead', correct: false },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'esc-feedback',
      kind: 'quiz',
      title: 'Tell us what you think',
      settings: { ...graded(0), mode: 'survey' },
      questions: [
        {
          id: 'esc-survey-useful',
          type: 'single_choice',
          prompt: richText('How useful was this course?'),
          points: 1,
          options: [
            { id: 'very', text: 'Very useful', correct: false },
            { id: 'somewhat', text: 'Somewhat useful', correct: false },
            { id: 'not', text: 'Not useful', correct: false },
          ],
        },
        {
          id: 'esc-survey-more',
          type: 'multiple_choice',
          prompt: richText('What would you like more of?'),
          points: 1,
          options: [
            { id: 'examples', text: 'Examples', correct: false },
            { id: 'practice', text: 'Practice', correct: false },
            { id: 'videos', text: 'Videos', correct: false },
          ],
        },
      ],
    },
  ],
});
