import type { Course, Lesson } from '../format/index';
import type { LearnerCourse, LearnerQuizLesson } from '../quiz/index';

/**
 * A course as the player shows it. Learners get the learner view from `GET /courses/:id`
 * (`learnerCourse`, decisions 0302 and 0314): each quiz lesson keeps its title, intro, settings and
 * `questionCount`, and its questions come one attempt at a time. Studio preview shows the full
 * draft. The player reads no quiz questions, so it takes either.
 */
export type PlayerCourse = Course | LearnerCourse;

/**
 * A lesson of a {@link PlayerCourse}: a content lesson, or a quiz lesson with or without its
 * questions.
 */
export type PlayerLesson = Lesson | LearnerQuizLesson;
