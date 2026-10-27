// player module (B5): pure view logic for the course player: the outline, links, search inside a course,
// button labels, sidebar and text size, and the active-time tracker. See docs/learning/PLAN.md.
export {
  ACTIVE_TRACKER_IDLE_MS,
  ACTIVE_TRACKER_MAX_SECONDS,
  createActiveTracker,
  stepActiveTracker,
  unsentActiveSeconds,
  type ActiveTimeChunk,
  type ActiveTracker,
  type ActiveTrackerInput,
} from './active-time';
export {
  PLAYER_TEXT_SIZES,
  PLAYER_TEXT_SIZE_KEY,
  parsePlayerTextSize,
  playerSidebar,
  playerTextScale,
  playerTextSizeLabel,
  stepPlayerTextSize,
  type PlayerSidebar,
  type PlayerSidebarSetting,
  type PlayerTextSize,
} from './display';
export {
  DEFAULT_PLAYER_LABELS,
  continueBlockLabel,
  playerLabels,
  type PlayerLabelKey,
  type PlayerLabels,
} from './labels';
export {
  blockAnchorId,
  blockIdFromHash,
  courseHref,
  lessonHref,
  linkTarget,
  type LinkTarget,
} from './links';
export {
  courseOutline,
  previousLessonId,
  type CourseOutline,
  type OutlineLessonStatus,
  type OutlineProgress,
  type OutlineRow,
} from './outline';
export {
  COURSE_SEARCH_MIN_LENGTH,
  buildCourseSearchIndex,
  searchCourse,
  searchCourseIndex,
  type CourseSearchHit,
  type CourseSearchIndex,
  type CourseSearchResult,
  type SearchSnippetPart,
} from './search';
