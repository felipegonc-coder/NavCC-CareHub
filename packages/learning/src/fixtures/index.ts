// fixtures module (B1): fictional sample courses, a learning path and people, for tests and demos.
// Every value is deeply frozen: copy before changing (for example with JSON.parse(JSON.stringify(x))).
import type { Course } from '../format/index';
import {
  sampleCertificationCourse,
  sampleMicrolearningCourse,
  sampleRequiredReadCourse,
  sampleScenarioLabCourse,
  sampleStandardCourse,
} from './courses';
import { sampleShowcaseCourse } from './showcase';

export {
  sampleCertificationCourse,
  sampleMicrolearningCourse,
  sampleRequiredReadCourse,
  sampleScenarioLabCourse,
  sampleShowcaseCourse,
  sampleStandardCourse,
};
export { sampleLearningPath } from './paths';
export { sampleGroups, sampleLearners } from './people';
export type { SampleGroup, SampleLearner } from './people';

/** Every sample course: one per course type, then the showcase of all blocks and questions. */
export const sampleCourses: readonly Course[] = Object.freeze([
  sampleStandardCourse,
  sampleScenarioLabCourse,
  sampleRequiredReadCourse,
  sampleMicrolearningCourse,
  sampleCertificationCourse,
  sampleShowcaseCourse,
]);
