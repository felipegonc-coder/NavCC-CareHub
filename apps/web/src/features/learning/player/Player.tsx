import {
  courseHref,
  courseOutline,
  playerSidebar,
  type Course,
  type Id,
  type LearnerCourseState,
  type NewProgressEvent,
} from '@carehub/learning';
import { IconButton, cn, useMediaQuery } from '@carehub/ui';
import { Menu, PanelLeft, PanelLeftClose, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { BlockViewMode } from '../blocks/registry';
import { LessonView } from './LessonView';
import { Outline } from './Outline';
import { outlinePercent, ProgressBar } from './ProgressBar';
import { useFollowLink } from './useFollowLink';

export type PlayerProps = {
  course: Course;
  state: LearnerCourseState;
  /** The open lesson; it must be one of the course's. */
  lessonId: Id;
  mode: BlockViewMode;
  emit(event: NewProgressEvent): void;
};

/** The phone layout's width (docs: under 768 px), where the outline becomes a menu. */
const PHONE = '(max-width: 767px)';

/** The course player: the outline (a sidebar, or a menu on phones) and the open lesson. */
export function Player({ course, state, lessonId, mode, emit }: PlayerProps) {
  const outlineId = useId();
  const narrow = useMediaQuery(PHONE);
  const [userOpen, setUserOpen] = useState<boolean>();
  const sidebar = playerSidebar(course.settings.sidebar, { narrow, userOpen });
  const outline = courseOutline(course, state, lessonId);
  const percent = outlinePercent(outline);
  const go = useFollowLink(course);

  const lesson = course.lessons.find((candidate) => candidate.id === lessonId);
  const row = outline.rows.find((candidate) => candidate.lessonId === lessonId);
  if (!lesson || !row) return null;
  const open = sidebar.kind !== 'none' && sidebar.open;
  const OutlineIcon =
    sidebar.kind === 'menu' ? (open ? X : Menu) : open ? PanelLeftClose : PanelLeft;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <title>{`Care Hub · ${lesson.title}`}</title>
      <header className="flex min-h-14 items-center gap-2 border-b border-border px-2 md:px-4">
        {sidebar.kind !== 'none' && (
          <IconButton
            label={open ? 'Hide course outline' : 'Show course outline'}
            aria-expanded={open}
            aria-controls={outlineId}
            onClick={() => setUserOpen(!open)}
            className="max-md:size-11"
          >
            <OutlineIcon aria-hidden />
          </IconButton>
        )}
        <Link
          to={courseHref(course.id)}
          className={cn(
            'min-w-0 flex-1 truncate px-2 py-3 text-small font-medium text-fg',
            'hover:underline',
          )}
        >
          {course.title}
        </Link>
        <div className="flex shrink-0 items-center gap-2 pr-2">
          <span aria-hidden className="text-small text-muted">
            {percent}%
          </span>
          <ProgressBar percent={percent} label="Course progress" className="w-16 md:w-32" />
        </div>
      </header>
      <div className="relative flex flex-1">
        {sidebar.kind !== 'none' && (
          <nav
            id={outlineId}
            aria-label="Course outline"
            hidden={!open}
            className={cn(
              'overflow-y-auto bg-sidebar',
              sidebar.kind === 'menu'
                ? 'absolute inset-0 z-10'
                : 'w-sidebar shrink-0 border-r border-border',
            )}
          >
            <Outline
              outline={outline}
              onPick={sidebar.kind === 'menu' ? () => setUserOpen(false) : undefined}
            />
          </nav>
        )}
        <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
          <LessonView
            key={lesson.id}
            course={course}
            lesson={lesson}
            row={row}
            state={state}
            mode={mode}
            emit={emit}
            go={go}
          />
        </main>
      </div>
    </div>
  );
}
