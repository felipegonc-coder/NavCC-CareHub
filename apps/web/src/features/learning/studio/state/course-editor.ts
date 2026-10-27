import { createHistory, pushHistory, redoHistory, undoHistory } from '@carehub/learning';
import type { Course, EditHistory, Id } from '@carehub/learning';

/** The course editor's state: the draft with its undo history, and what is selected. */
export type CourseEditorState = {
  history: EditHistory<Course>;
  /** The lesson on the canvas; null only when the course has no lessons. */
  lessonId: Id | null;
  /** The block being edited on the canvas, if any. */
  blockId: Id | null;
};

/** What to select after an edit (for example the block just added). Leave a field out to keep it. */
export type CourseEditorSelection = { lessonId?: Id | null; blockId?: Id | null };

/** Everything that changes the course editor's state. */
export type CourseEditorAction =
  | {
      type: 'edit';
      /** A pure edit from the authoring module, e.g. `(c) => renameLesson(c, id, title)`. */
      edit: (course: Course) => Course;
      /** Typing in the same field (e.g. "text:<blockId>") within a second is one undo step. */
      group?: string;
      /** When the edit happened (Date.now()), for `group`. */
      at?: number;
      select?: CourseEditorSelection;
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; lessonId: Id | null; blockId?: Id | null }
  /** Replaces the draft (e.g. after loading someone else's newer save); clears undo. */
  | { type: 'load'; course: Course };

/**
 * Keeps the selection on things that exist. A removed lesson hands over to the one now in its place (or the
 * last); a block that is gone is unselected.
 */
function fixSelection(state: CourseEditorState, before?: Course): CourseEditorState {
  const { lessons } = state.history.present;
  let { lessonId } = state;
  if (!lessons.some((l) => l.id === lessonId)) {
    const at = before?.lessons.findIndex((l) => l.id === lessonId) ?? -1;
    lessonId = lessons[Math.min(Math.max(at, 0), lessons.length - 1)]?.id ?? null;
  }
  const lesson = lessons.find((l) => l.id === lessonId);
  const blockId =
    lesson?.kind === 'content' && lesson.blocks.some((b) => b.id === state.blockId)
      ? state.blockId
      : null;
  return lessonId === state.lessonId && blockId === state.blockId
    ? state
    : { ...state, lessonId, blockId };
}

/** The state for a freshly opened draft, on `lessonId` or the first lesson. */
export function initCourseEditor(course: Course, lessonId: Id | null = null): CourseEditorState {
  return fixSelection({ history: createHistory(course), lessonId, blockId: null });
}

/** The course editor's reducer (for `useReducer`). Edits that change nothing return the same state. */
export function courseEditorReducer(
  state: CourseEditorState,
  action: CourseEditorAction,
): CourseEditorState {
  const before = state.history.present;
  switch (action.type) {
    case 'edit': {
      const history = pushHistory(state.history, action.edit(before), action);
      if (history === state.history && !action.select) return state;
      const { lessonId = state.lessonId, blockId = state.blockId } = action.select ?? {};
      return fixSelection({ history, lessonId, blockId }, before);
    }
    case 'undo':
    case 'redo': {
      const history = (action.type === 'undo' ? undoHistory : redoHistory)(state.history);
      return history === state.history ? state : fixSelection({ ...state, history }, before);
    }
    case 'select': {
      const next = fixSelection({
        ...state,
        lessonId: action.lessonId,
        blockId: action.blockId ?? null,
      });
      return next.lessonId === state.lessonId && next.blockId === state.blockId ? state : next;
    }
    case 'load':
      return fixSelection({ ...state, history: createHistory(action.course) }, before);
  }
}
