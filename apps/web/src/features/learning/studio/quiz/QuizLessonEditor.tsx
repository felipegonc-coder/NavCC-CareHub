import { updateLessonDetails, updateQuizSettings } from '@carehub/learning';
import type { Course, QuizLesson } from '@carehub/learning';
import { useId, type ReactNode } from 'react';
import { RichTextInput } from '../editors/text/RichTextInput';
import { BankDrawsEditor } from './BankDrawsEditor';
import { editQuiz } from './edit';
import { QuizQuestions } from './QuizQuestions';
import { QuizSettingsEditor } from './QuizSettingsEditor';

/** Props for {@link QuizLessonEditor} (docs/learning/PLAN.md). */
export type QuizLessonEditorProps = {
  lesson: QuizLesson;
  onChange(next: QuizLesson): void;
  /** Optional: the course, for links to its lessons and ids that are unique across it. */
  course?: Course;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-body font-medium text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The Studio editor for a quiz lesson: its settings (graded or survey, pass mark, tries, answers, shuffling,
 * question pool), intro, own questions and questions drawn from banks.
 */
export function QuizLessonEditor({ lesson, onChange, course }: QuizLessonEditorProps) {
  const introId = useId();
  const edit = (change: Parameters<typeof editQuiz>[2]) =>
    onChange(editQuiz(lesson, course, change));
  return (
    <div className="flex flex-col gap-8">
      <Section title="Settings">
        <QuizSettingsEditor
          settings={lesson.settings}
          questionCount={lesson.questions.length}
          onChange={(patch) => edit((c, lessonId) => updateQuizSettings(c, lessonId, patch))}
        />
      </Section>
      <Section title="Intro">
        <RichTextInput
          id={introId}
          ariaLabel="Intro"
          placeholder="What the quiz covers and anything people should know first (optional)"
          value={lesson.intro ?? []}
          onChange={(intro) => edit((c, lessonId) => updateLessonDetails(c, lessonId, { intro }))}
          course={course}
        />
      </Section>
      <Section title="Questions">
        <QuizQuestions lesson={lesson} onChange={onChange} course={course} />
      </Section>
      <Section title="Questions from banks">
        <BankDrawsEditor lesson={lesson} onChange={onChange} />
      </Section>
    </div>
  );
}
