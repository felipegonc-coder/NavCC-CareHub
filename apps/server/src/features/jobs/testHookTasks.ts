/**
 * The periodic tasks the end-to-end test hook (`POST /api/jobs/test/periodic/:name`) may run, each
 * with the one-line reason it's safe to run early. Any other name is a 404.
 *
 * Never list a task that deletes, purges or applies retention (a future `now` would delete real
 * data; test those in unit tests with an injected clock), or one that sends anything outside the
 * server (email, push, webhooks). A task whose work can lead to web push may be listed once that
 * push skips test-hook runs (`isTestHookRun()`) and marks their notices not-for-push. Each change
 * here needs a security review.
 *
 * Left out for now: `jobs.cleanup` (deletes finished jobs) and every task that can lead to web
 * push (reminders, notices, Learning due reminders, automations).
 */
export const TEST_HOOK_TASKS: Readonly<Record<string, string>> = Object.freeze({});
