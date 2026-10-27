import { useParams } from 'react-router';

/**
 * The course that uploads belong to (scope `learning:<courseId>`): the `courseId` passed in, or else the one in
 * the page address (every Studio course page has it). Undefined when there is neither.
 */
export function useCourseId(courseId?: string): string | undefined {
  const params = useParams();
  return courseId ?? params.courseId;
}
