import {
  courseHref,
  courseOutline,
  playerSidebar,
  playerTextScale,
  type Id,
  type LearnerCourseState,
  type NewProgressEvent,
  type PlayerCourse,
} from '@carehub/learning';
import { IconButton, cn, useMediaQuery } from '@carehub/ui';
import { Menu, PanelLeft, PanelLeftClose, Search, Type, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { BlockViewMode } from '../blocks/registry';
import { CourseSearch } from './CourseSearch';
import { LessonView } from './LessonView';
import { Outline } from './Outline';
import { outlinePercent, ProgressBar } from './ProgressBar';
import { TextSizeControl, usePlayerTextSize } from './TextSize';
import { useFollowLink } from './useFollowLink';

export type PlayerProps = {
  course: PlayerCourse;
  state: LearnerCourseState;
  /** The open lesson; it must be one of the course's. */
  lessonId: Id;
  mode: BlockViewMode;
  emit(event: NewProgressEvent): void;
};

/** The phone layout's width (docs: under 768 px), where the outline becomes a menu. */
const PHONE = '(max-width: 767px)';

/** The header's tools, each opening a panel under it: search inside the course, and text size. */
type Tool = 'search' | 'text';

/**
 * The course player: the outline (a sidebar, or a menu on phones), search inside the course, the
 * text size, and the open lesson.
 */
export function Player({ course, state, lessonId, mode, emit }: PlayerProps) {
  const outlineId = useId();
  const toolId = useId();
  const narrow = useMediaQuery(PHONE);
  const [userOpen, setUserOpen] = useState<boolean>();
  const sidebar = playerSidebar(course.settings.sidebar, { narrow, userOpen });
  const outline = courseOutline(course, state, lessonId);
  const percent = outlinePercent(outline);
  const go = useFollowLink(course);
  const [tool, setTool] = useState<Tool | null>(null);
  const [query, setQuery] = useState('');
  const [textSize, setTextSize] = usePlayerTextSize();
  const scale = playerTextScale(textSize);
  const searchButton = useRef<HTMLButtonElement>(null);
  const textButton = useRef<HTMLButtonElement>(null);
  const toggle = (next: Tool) => setTool((open) => (open === next ? null : next));

  // Escape closes the open tool and goes back to its button.
  useEffect(() => {
    if (!tool) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setTool(null);
      (tool === 'search' ? searchButton : textButton).current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tool]);

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
        <IconButton
          ref={searchButton}
          label="Search this course"
          aria-expanded={tool === 'search'}
          aria-controls={toolId}
          onClick={() => toggle('search')}
          className="max-md:size-11"
        >
          <Search aria-hidden />
        </IconButton>
        <IconButton
          ref={textButton}
          label="Text size"
          aria-expanded={tool === 'text'}
          aria-controls={toolId}
          onClick={() => toggle('text')}
          className="max-md:size-11"
        >
          <Type aria-hidden />
        </IconButton>
        <div className="flex shrink-0 items-center gap-2 pr-2">
          <span aria-hidden className="text-small text-muted max-md:hidden">
            {percent}%
          </span>
          <ProgressBar percent={percent} label="Course progress" className="w-16 md:w-32" />
        </div>
      </header>
      {tool && (
        <div id={toolId} className="border-b border-border px-4 py-4 md:px-8">
          <div className="mx-auto w-full max-w-page">
            {tool === 'search' ? (
              <CourseSearch
                course={course}
                rows={outline.rows}
                query={query}
                onQuery={setQuery}
                onPick={() => setTool(null)}
              />
            ) : (
              <TextSizeControl size={textSize} onChange={setTextSize} />
            )}
          </div>
        </div>
      )}
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
          {/* Bigger text draws the lesson larger, as the browser's zoom does, so its rem-based
              text and spacing grow together; the layout still fits the screen. */}
          <div data-text-size={textSize} style={scale === 1 ? undefined : { zoom: scale }}>
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
          </div>
        </main>
      </div>
    </div>
  );
}
