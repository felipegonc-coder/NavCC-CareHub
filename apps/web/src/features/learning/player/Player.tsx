import {
  courseHref,
  courseOutline,
  linkTarget,
  playerSidebar,
  type Course,
  type Link as CourseLink,
  type Id,
  type LearnerCourseState,
  type NewProgressEvent,
} from '@carehub/learning';
import { IconButton, cn, useMediaQuery } from '@carehub/ui';
import { Menu, PanelLeft, PanelLeftClose, X } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BlockViewMode } from '../blocks/registry';
import { LessonView } from './LessonView';
import { Outline } from './Outline';

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
  const navigate = useNavigate();
  const outlineId = useId();
  const narrow = useMediaQuery(PHONE);
  const [userOpen, setUserOpen] = useState<boolean>();
  const sidebar = playerSidebar(course.settings.sidebar, { narrow, userOpen });
  const outline = courseOutline(course, state, lessonId);

  const go = useCallback(
    (link: CourseLink) => {
      const target = linkTarget(course, link);
      if (target.kind === 'lesson' || target.kind === 'page') navigate(target.href);
      else if (target.kind === 'broken') return;
      else if (target.newTab) window.open(target.href, '_blank', 'noopener,noreferrer');
      else window.location.assign(target.href);
    },
    [course, navigate],
  );

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
          className="min-w-0 truncate px-2 py-3 text-small font-medium text-fg hover:underline"
        >
          {course.title}
        </Link>
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
