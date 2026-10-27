import { test } from '@playwright/test';

// Does nothing. Every other project waits for this one, and the project "workspace" is its
// teardown, so the files named *.workspace.e2e.ts run after every other test has finished
// (playwright.config.ts).
test('the other projects run first; the workspace project runs after them', () => {});
