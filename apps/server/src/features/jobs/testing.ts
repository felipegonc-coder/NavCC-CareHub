import { jobRunner } from './index';

/**
 * Runs every due job (and due retries) in this process until none are left. Pass `now` to run
 * jobs scheduled for later. Periodic tasks don't run; call your task function directly.
 */
export function drainJobsForTest(options?: { now?: Date }): Promise<{ ran: number }> {
  return jobRunner.drain(options);
}
