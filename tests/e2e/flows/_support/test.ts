// The one `test` and `expect` every flow imports, so shared fixtures can be added here later
// without touching the flows. Import from '../_support/index.js', never from '@playwright/test'.
import { expect, test } from '@playwright/test';

export { expect, test };
