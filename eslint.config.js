import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import carehub from './packages/ui/lint/no-one-off-styles.js';

// Colours, type, sizes and corners come from the design kit (AGENTS.md section 6, decision 0008).
// carehub/no-one-off-styles is an error in the web app and the packages, and a warning in the lane
// folders (AGENTS.md section 5) for now; scripts/lint.mjs lets those warnings pass. When the lanes
// switch over (decision 0008), the lane block below goes, so it is an error everywhere.
const uiCode = ['apps/web/**/*.{js,jsx,ts,tsx}', 'packages/**/*.{js,jsx,ts,tsx}'];
const laneCode = [
  'packages/learning*/**/*.{js,jsx,ts,tsx}',
  'packages/databases*/**/*.{js,jsx,ts,tsx}',
  'packages/team-*/**/*.{js,jsx,ts,tsx}',
  'apps/web/src/features/{learning,databases,forms,messages,notices,live,push,jobs,reminders,home,calendar,meetings,automations,analytics,status,claude,notifications}/**/*.{js,jsx,ts,tsx}',
];
// The files that define the kit's values, configs, and tests (which spell out what they check).
const styleExempt = [
  'packages/ui/src/{tokens,palette,scale}.ts',
  'packages/ui/tailwind-preset.ts',
  'packages/ui/lint/**',
  '**/*.config.{js,ts,mjs,cjs}',
  '**/*.test.{js,jsx,ts,tsx}',
  '**/test/**',
];

export default [
  {
    ignores: ['**/dist/', '**/coverage/', '**/playwright-report/', '**/test-results/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
    },
  },
  {
    files: uiCode,
    ignores: styleExempt,
    plugins: { carehub },
    rules: { 'carehub/no-one-off-styles': 'error' },
  },
  {
    files: laneCode,
    ignores: styleExempt,
    plugins: { carehub },
    rules: { 'carehub/no-one-off-styles': 'warn' },
  },
];
