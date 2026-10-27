// Lazy route module for /forms/:code (react-router `lazy` reads `Component`). The page handles
// sign-in itself (it sends people who aren't signed in to sign in and back), so it needs no shell.
export { FormPage as Component } from './form-page';
