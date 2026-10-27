import type { LearningPath } from '../format/index';
import { frozen } from './shared';

/** A new-starter path through three of the sample courses, in order. */
export const sampleLearningPath: LearningPath = frozen({
  formatVersion: 1,
  id: 'path-new-starter',
  title: 'New starter path',
  description: 'Your first two weeks at Brightside Support.',
  courseIds: ['course-calls-with-care', 'course-privacy-basics', 'course-escalations-cert'],
  order: 'sequential',
});
