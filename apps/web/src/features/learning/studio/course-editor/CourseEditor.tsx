import { canRedo, canUndo, checkPublishable } from '@carehub/learning';
import type { Course, Id, PublishProblem } from '@carehub/learning';
import { Button, IconButton } from '@carehub/ui';
import { ArrowLeft, Eye, History, Redo2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { StudioDraft } from '../data/client';
import { useStudioDraft } from '../data/queries';
import { previewPath } from '../labels';
import { courseEditorReducer, initCourseEditor } from '../state/course-editor';
import { ErrorState, LoadingState } from '../states';
import { CourseSettings } from './CourseSettings';
import { LessonCanvas } from './LessonCanvas';
import { Outline } from './Outline';
import { SaveState, UndoNotice } from './parts';
import { ProblemsPanel, PublishDialog } from './PublishPanel';
import { useDraftAutosave } from './use-autosave';
import type { EditorActions, EditOptions } from './types';
import { VersionsPanel } from './VersionsPanel';

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

/** Course-level problems go to the settings, unless they are about the title or the lessons. */
const SETTINGS_PATH = /^(settings|cover|description)/;

function Editor({ draft }: { draft: StudioDraft }) {
  const navigate = useNavigate();
  const opened = new URLSearchParams(useLocation().search).get('lesson');
  const [state, dispatch] = useReducer(courseEditorReducer, draft.course, (course) =>
    initCourseEditor(course, opened),
  );
  const course = state.history.present;
  const saving = useDraftAutosave(course.id, draft.revision, course);
  const [notice, setNotice] = useState<{ message: string; after: Course } | null>(null);
  const [view, setView] = useState<'lesson' | 'settings'>('lesson');
  const [panel, setPanel] = useState<'problems' | 'versions' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<PublishProblem[]>([]);
  const [liveVersion, setLiveVersion] = useState(draft.liveVersion);
  const [published, setPublished] = useState('');
  const found = useMemo(() => checkPublishable(course), [course]);
  const problems = found.length > 0 ? found : refused;

  const edit = useCallback<EditorActions['edit']>((change, options: EditOptions = {}) => {
    if (options.select?.lessonId) setView('lesson');
    dispatch({ type: 'edit', edit: change, at: Date.now(), ...options });
  }, []);
  const actions: EditorActions = {
    edit,
    remove: (message, change) => {
      const next = change(course);
      if (next === course) return;
      dispatch({ type: 'edit', edit: () => next });
      setNotice({ message, after: next });
    },
    select: (lessonId) => {
      setView('lesson');
      dispatch({ type: 'select', lessonId });
    },
  };
  const show = (problem: PublishProblem) => {
    if (problem.lessonId) {
      setView('lesson');
      dispatch({ type: 'select', lessonId: problem.lessonId, blockId: problem.blockId ?? null });
    } else setView(SETTINGS_PATH.test(problem.path) ? 'settings' : 'lesson');
  };
  const toggleVersions = () => {
    setPublished('');
    setPanel(panel === 'versions' ? null : 'versions');
  };
  const startPublishing = () => {
    setPublished('');
    if (problems.length > 0) {
      setPanel('problems');
      return;
    }
    if (panel === 'problems') setPanel(null);
    setConfirming(true);
  };
  const preview = async () => {
    await saving.flush();
    await navigate(previewPath(course.id));
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
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title text-fg">{course.title}</h1>
          <p className="text-small text-muted">
            {liveVersion === null ? 'Draft, not published yet' : `Live, version ${liveVersion}`}
          </p>
        </div>
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
        <Button asChild size="sm" variant="secondary">
          <Link
            to={previewPath(course.id)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              void preview();
            }}
          >
            <Eye aria-hidden />
            Preview
          </Link>
        </Button>
        {liveVersion !== null && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={panel === 'versions'}
            onClick={toggleVersions}
          >
            <History aria-hidden />
            Versions
          </Button>
        )}
        <Button size="sm" onClick={startPublishing}>
          Publish
        </Button>
        <PublishDialog
          open={confirming}
          onOpenChange={setConfirming}
          courseId={course.id}
          liveVersion={liveVersion}
          flush={saving.flush}
          onPublished={(version) => {
            setConfirming(false);
            setRefused([]);
            setLiveVersion(version);
            setPublished(
              version === 1
                ? 'Published version 1. People with access can start it now.'
                : `Published version ${version}. People who start from now get it.`,
            );
          }}
          onRefused={(list) => {
            setConfirming(false);
            setRefused(list);
            setPanel('problems');
          }}
        />
      </header>
      <p role="status" className="px-4 text-small text-fg empty:hidden">
        {published}
      </p>
      {(panel || notice?.after === course) && (
        <div className="flex flex-col gap-2 px-4 pt-2">
          {notice?.after === course && (
            <UndoNotice message={notice.message} onUndo={() => dispatch({ type: 'undo' })} />
          )}
          {panel === 'problems' && (
            <ProblemsPanel problems={problems} onShow={show} onClose={() => setPanel(null)} />
          )}
          {panel === 'versions' && (
            <VersionsPanel
              courseId={course.id}
              flush={saving.flush}
              onClose={() => setPanel(null)}
              onRolledBack={async (version) => {
                dispatch({ type: 'load', course: await saving.reload() });
                setLiveVersion(version);
                setPanel(null);
                setPublished(`Rolled back: version ${version} is live and is your draft now.`);
              }}
            />
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col md:flex-row">
        <Outline
          {...actions}
          course={course}
          lessonId={view === 'lesson' ? state.lessonId : null}
          settingsOpen={view === 'settings'}
          onSettings={() => setView('settings')}
        />
        {view === 'settings' ? (
          <CourseSettings course={course} edit={edit} />
        ) : (
          <LessonCanvas
            key={state.lessonId}
            {...actions}
            course={course}
            lesson={course.lessons.find((lesson) => lesson.id === state.lessonId)}
            blockId={state.blockId}
            flush={async () => (await saving.flush()) === 'saved'}
          />
        )}
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
