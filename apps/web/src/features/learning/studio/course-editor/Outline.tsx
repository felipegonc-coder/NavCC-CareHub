import {
  deleteLesson,
  duplicateLesson,
  insertLesson,
  moveLesson,
  moveLessonBy,
  newLesson,
  renameCourse,
} from '@carehub/learning';
import type { Course, Id, Lesson } from '@carehub/learning';
import { Button, cn, IconButton } from '@carehub/ui';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { lessonPath } from '../labels';
import { TitleField } from './parts';
import { SortableList, useSortableItem } from './sortable';
import type { EditorActions } from './types';

const moveClasses = 'aria-disabled:text-faint';

function LessonRow(
  props: EditorActions & {
    courseId: Id;
    lesson: Lesson;
    index: number;
    count: number;
    selected: boolean;
  },
) {
  const { lesson, index, count, selected, edit, remove, select } = props;
  const item = useSortableItem(lesson.id, `Reorder ${lesson.title}`);
  return (
    <li
      ref={item.ref}
      style={item.style}
      className={cn(
        'flex items-center gap-1 rounded',
        selected && 'bg-fill',
        item.dragging && 'shadow-menu',
      )}
    >
      {item.handle}
      <Link
        to={lessonPath(props.courseId, lesson.id)}
        replace
        aria-current={selected || undefined}
        className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-small text-fg hover:bg-fill-hover"
        onClick={() => select(lesson.id)}
      >
        {index + 1}. {lesson.title}
        {lesson.kind === 'quiz' && !/quiz/i.test(lesson.title) && (
          <span className="text-muted"> · Quiz</span>
        )}
      </Link>
      {selected && (
        <>
          <IconButton
            size="sm"
            label={`Move ${lesson.title} up`}
            aria-disabled={index === 0}
            className={moveClasses}
            onClick={() => edit((c) => moveLessonBy(c, lesson.id, -1))}
          >
            <ArrowUp aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={`Move ${lesson.title} down`}
            aria-disabled={index === count - 1}
            className={moveClasses}
            onClick={() => edit((c) => moveLessonBy(c, lesson.id, 1))}
          >
            <ArrowDown aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={`Duplicate ${lesson.title}`}
            onClick={() => edit((c) => duplicateLesson(c, lesson.id))}
          >
            <Copy aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={`Delete ${lesson.title}`}
            onClick={() => remove(`Deleted “${lesson.title}”.`, (c) => deleteLesson(c, lesson.id))}
          >
            <Trash2 aria-hidden />
          </IconButton>
        </>
      )}
    </li>
  );
}

/** Props for {@link Outline}. */
export type OutlineProps = EditorActions & {
  course: Course;
  /** The lesson on the canvas, or null when there is none. */
  lessonId: Id | null;
};

/** The course title and the lessons: select, add, reorder (drag or move buttons), duplicate and delete. */
export function Outline(props: OutlineProps) {
  const { course, lessonId, edit } = props;
  const add = (kind: Lesson['kind']) => {
    const lesson = newLesson(course, kind);
    edit((c) => insertLesson(c, lesson), { select: { lessonId: lesson.id } });
  };
  const ids = course.lessons.map((lesson) => lesson.id);
  const title = (id: string) =>
    course.lessons.find((lesson) => lesson.id === id)?.title ?? 'Lesson';
  return (
    <div className="flex flex-col gap-4 border-b border-border p-4 md:w-sidebar md:shrink-0 md:border-b-0 md:border-r">
      <TitleField
        label="Course title"
        value={course.title}
        onChange={(text) => edit((c) => renameCourse(c, text), { group: 'course-title' })}
      />
      <nav aria-label="Outline" className="flex flex-col gap-2">
        <h2 className="text-small font-semibold text-muted">Lessons</h2>
        {course.lessons.length === 0 ? (
          <p className="text-small text-muted">No lessons yet. Add one to start.</p>
        ) : (
          <SortableList
            ids={ids}
            name={title}
            onMove={(id, to) => edit((c) => moveLesson(c, id, to))}
          >
            <ol className="flex flex-col gap-1">
              {course.lessons.map((lesson, index) => (
                <LessonRow
                  key={lesson.id}
                  {...props}
                  courseId={course.id}
                  lesson={lesson}
                  index={index}
                  count={course.lessons.length}
                  selected={lesson.id === lessonId}
                />
              ))}
            </ol>
          </SortableList>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => add('content')}>
            <Plus aria-hidden />
            Add lesson
          </Button>
          <Button size="sm" variant="secondary" onClick={() => add('quiz')}>
            <Plus aria-hidden />
            Add quiz
          </Button>
        </div>
      </nav>
    </div>
  );
}
