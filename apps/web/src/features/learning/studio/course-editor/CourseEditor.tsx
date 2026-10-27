import { canRedo, canUndo } from '@carehub/learning';
import type { Course, Id } from '@carehub/learning';
import { Button, IconButton } from '@carehub/ui';
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { Link } from 'react-router';
import type { StudioDraft } from '../data/client';
import { useStudioDraft } from '../data/queries';
import { courseEditorReducer, initCourseEditor } from '../state/course-editor';
import { ErrorState, LoadingState } from '../states';
import { LessonCanvas } from './LessonCanvas';
import { Outline } from './Outline';
import { SaveState, UndoNotice } from './parts';
import { useDraftAutosave } from './use-autosave';
import type { EditorActions, EditOptions } from './types';

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to="/learning/studio">
        <ArrowLeft aria-hidden />
        Studio
      </Link>
    </Button>
  );
}

function Editor({ draft }: { draft: StudioDraft }) {
  const [state, dispatch] = useReducer(courseEditorReducer, draft.course, (course) =>
    initCourseEditor(course),
  );
  const course = state.history.present;
  const saving = useDraftAutosave(course.id, draft.revision, course);
  const [notice, setNotice] = useState<{ message: string; after: Course } | null>(null);

  const edit = useCallback<EditorActions['edit']>(
    (change, options: EditOptions = {}) =>
      dispatch({ type: 'edit', edit: change, at: Date.now(), ...options }),
    [],
  );
  const actions: EditorActions = {
    edit,
    remove: (message, change) => {
      const next = change(course);
      if (next === course) return;
      dispatch({ type: 'edit', edit: () => next });
      setNotice({ message, after: next });
    },
    select: (lessonId) => dispatch({ type: 'select', lessonId }),
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (key !== 'z' && key !== 'y')) return;
      event.preventDefault();
      dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="flex min-h-dvh flex-col">
      <title>{`Care Hub · ${course.title}`}</title>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <BackLink />
        <h1 className="min-w-0 flex-1 truncate text-title text-fg">{course.title}</h1>
        <SaveState saving={saving} onLoad={(next) => dispatch({ type: 'load', course: next })} />
        <IconButton
          label="Undo"
          aria-keyshortcuts="Control+Z Meta+Z"
          disabled={!canUndo(state.history)}
          onClick={() => dispatch({ type: 'undo' })}
        >
          <Undo2 aria-hidden />
        </IconButton>
        <IconButton
          label="Redo"
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          disabled={!canRedo(state.history)}
          onClick={() => dispatch({ type: 'redo' })}
        >
          <Redo2 aria-hidden />
        </IconButton>
      </header>
      {notice?.after === course && (
        <div className="px-4 pt-2">
          <UndoNotice message={notice.message} onUndo={() => dispatch({ type: 'undo' })} />
        </div>
      )}
      <div className="flex flex-1 flex-col md:flex-row">
        <Outline {...actions} course={course} lessonId={state.lessonId} />
        <LessonCanvas
          key={state.lessonId}
          {...actions}
          course={course}
          lesson={course.lessons.find((lesson) => lesson.id === state.lessonId)}
          blockId={state.blockId}
        />
      </div>
    </main>
  );
}

/** `/learning/studio/courses/:courseId`: loads the draft, then edits it with autosave and undo. */
export function CourseEditor({ courseId }: { courseId: Id }) {
  const draft = useStudioDraft(courseId);
  if (draft.data) return <Editor draft={draft.data} />;
  return (
    <main className="mx-auto flex max-w-page flex-col items-start gap-4 px-6 py-8">
      <title>Care Hub · Edit course</title>
      <BackLink />
      <h1 className="text-title text-fg">Edit course</h1>
      {draft.isError ? (
        <ErrorState error={draft.error} onRetry={() => void draft.refetch()} />
      ) : (
        <LoadingState label="Loading the course" />
      )}
    </main>
  );
}
