// The knowledge base's hook for the end-to-end tests (tests/e2e), on only when CAREHUB_TEST_HOOKS
// is "1", which no deploy file sets. With it on, POST /api/knowledge/pages/:pageId/verification
// {period: 'date', until} also takes today and earlier days, so a test can make a page Expired
// without waiting. Nothing else changes: sign-in, CSRF, who may verify, the date format and the
// ten-year limit are checked as usual.
import { z } from 'zod';
import { readSettings, type ReadSettingsOptions } from '../../core/settings';

/** Decision 0007, sections 2.3 and 2.5. Only end-to-end test servers set it; never production. */
const testSettings = z.object({
  CAREHUB_TEST_HOOKS: z.enum(['0', '1']).optional(),
});

/** Whether the test hook is on: only with CAREHUB_TEST_HOOKS=1. */
// stand-in: core's testHooksEnabled(config) (decision 0007, section 2.5)
export function testHooksOn(options?: ReadSettingsOptions): boolean {
  return readSettings(testSettings, options).CAREHUB_TEST_HOOKS === '1';
}
