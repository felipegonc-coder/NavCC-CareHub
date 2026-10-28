import { blockCatalog, COURSE_TYPES } from '@carehub/learning';
import type { Block, CourseType } from '@carehub/learning';
import type { StudioCourseSummary } from './data/client';

/** Each course type's name and what its preset sets up, for New course and the course list. */
export const COURSE_TYPE_INFO: Record<CourseType, { label: string; description: string }> = {
  standard: {
    label: 'Standard',
    description: 'Lessons in any order, with a final quiz if you add one.',
  },
  scenario_lab: {
    label: 'Scenario lab',
    description: 'Practice with customer conversations. Pass mark 70%.',
  },
  required_read: {
    label: 'Required read',
    description:
      'Lessons in order, an "I have read and understood" sign-off and a quiz to pass with 100%.',
  },
  microlearning: { label: 'Microlearning', description: 'One short lesson for a quick refresher.' },
  certification: {
    label: 'Certification',
    description:
      'Lessons in order, a quiz with a 90% pass mark and 3 tries, and a certificate for a year.',
  },
};

/** The course types as choices, in the format's order. */
export const COURSE_TYPE_CHOICES: readonly {
  value: CourseType;
  label: string;
  description: string;
}[] = COURSE_TYPES.map((value) => ({ value, ...COURSE_TYPE_INFO[value] }));

/** "Draft", "Live, version 3" or "Live, version 3, with unpublished changes". */
export function courseStateLabel(course: Pick<StudioCourseSummary, 'state' | 'version'>): string {
  if (course.state === 'draft' || course.version === null) return 'Draft';
  const live = `Live, version ${course.version}`;
  return course.state === 'changed' ? `${live}, with unpublished changes` : live;
}

/** The course editor's address. */
export const editorPath = (courseId: string): string =>
  `/learning/studio/courses/${encodeURIComponent(courseId)}`;

/** The course editor's address with `lessonId` open. */
export const lessonPath = (courseId: string, lessonId: string): string =>
  `${editorPath(courseId)}?lesson=${encodeURIComponent(lessonId)}`;

/** The course preview's address. */
export const previewPath = (courseId: string): string => `${editorPath(courseId)}/preview`;

/** "Paragraph", "Image", "Knowledge check"… for a block. */
export function blockLabel(block: Block): string {
  if (block.type === 'knowledge_check') return 'Knowledge check';
  return blockCatalog.find((entry) => entry.key === block.type)?.label ?? block.type;
}
