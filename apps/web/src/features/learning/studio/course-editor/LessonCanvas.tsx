import { renameLesson } from '@carehub/learning';
import type { Lesson } from '@carehub/learning';
import { TitleField } from './parts';
import type { EditorActions } from './types';

/**
 * The open lesson: its title for now. The next Studio PR adds its blocks, the add-block menu and the lesson's
 * minimum time; quizzes get the quiz editor.
 */
export function LessonCanvas(props: Pick<EditorActions, 'edit'> & { lesson: Lesson | undefined }) {
  const { lesson, edit } = props;
  if (!lesson) {
    return (
      <section aria-label="Lesson" className="min-w-0 flex-1 p-4 md:p-6">
        <p className="text-body text-muted">
          This course has no lessons yet. Add a lesson or a quiz to start.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label={`Lesson: ${lesson.title}`}
      className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6"
    >
      <TitleField
        label="Lesson title"
        value={lesson.title}
        onChange={(text) =>
          edit((c) => renameLesson(c, lesson.id, text), { group: `lesson-title:${lesson.id}` })
        }
      />
      <p className="rounded border border-border p-4 text-small text-muted">
        {lesson.kind === 'quiz'
          ? 'Quiz questions and settings are edited here once the quiz editor is ready.'
          : "The lesson's blocks are edited here once the lesson canvas is ready."}
      </p>
    </section>
  );
}
