import { jobRunner } from './index';

/**
 * Runs every due job (and due retries) in this process until none are left. Pass `now` to run
 * jobs scheduled for later. Periodic tasks don't run; call your task function directly.
 */
export function drainJobsForTest(options?: { now?: Date }): Promise<{ ran: number }> {
  return jobRunner.drain(options);
}

/**
 * Stops the test app's runner from picking up jobs by itself, so a job that's due at once can't
 * run before the test's next request. `drainJobsForTest` still runs them. Call the returned
 * function to go back to normal. With more than one app open, the runner keeps running.
 */
export async function pauseJobsForTest(): Promise<() => Promise<void>> {
  if (!jobRunner.isRunning()) return async () => {};
  await jobRunner.stop();
  return () => jobRunner.start();
}
