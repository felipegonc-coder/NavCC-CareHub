import { linkTarget, type Course, type Link as CourseLink } from '@carehub/learning';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';

/**
 * Follows a link in a course (`linkTarget`): lessons and Care Hub pages open in the app, web links
 * in this tab or a new one, and a broken link does nothing (its text already says why).
 */
export function useFollowLink(course: Pick<Course, 'id' | 'lessons'>) {
  const navigate = useNavigate();
  return useCallback(
    (link: CourseLink) => {
      const target = linkTarget(course, link);
      if (target.kind === 'lesson' || target.kind === 'page') navigate(target.href);
      else if (target.kind === 'broken') return;
      else if (target.newTab) window.open(target.href, '_blank', 'noopener,noreferrer');
      else window.location.assign(target.href);
    },
    [course, navigate],
  );
}
