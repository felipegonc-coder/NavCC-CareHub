/**
 * The course version of a learner's latest run, or null when they haven't started (decision 0311).
 * `GET /courses/:id` (B1) sends that version, else the live one. It reads the learner's progress
 * row, as the progress routes and the quiz attempts route do.
 */
export { runVersion } from './service';
