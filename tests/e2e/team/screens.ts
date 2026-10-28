import type { Screen } from '../screens.js';

// The screens of the team lane. Names start with "team-"; see ../README.md.
export const screens: Screen[] = [
  // Reminders (Home's See all). Until sign-in is on main it shows its error state.
  { name: 'team-reminders', path: '/reminders' },
];
