import { learningItemSchema } from '@carehub/team-calendar-api';
import { describe, expect, it } from 'vitest';
import { learningItemOf } from './courses';

describe('course due dates', () => {
  it('shows one as an all-day, read-only item on the Learning layer', () => {
    const item = learningItemOf({
      assignmentId: 'a1',
      courseId: 'course-1',
      title: 'Safe lifting refresher',
      dueDate: '2026-10-30',
      href: '/learning/courses/course-1',
    });
    expect(learningItemSchema.parse(item)).toEqual({
      source: 'learning',
      id: 'learning:a1',
      layerId: 'learning',
      title: 'Safe lifting refresher',
      allDay: true,
      start: '2026-10-30',
      end: '2026-10-31',
      timeZone: null,
      canEdit: false,
      courseId: 'course-1',
      url: '/learning/courses/course-1',
    });
  });
});
