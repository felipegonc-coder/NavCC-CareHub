/* global document, window */
// Applies the saved Care Hub theme before the first paint, so dark mode doesn't flash white.
// Loaded by index.html as a file because the Content Security Policy allows no inline scripts.
// Keep the key and query in step with THEME_STORAGE_KEY and DARK_QUERY in @carehub/ui
// (src/theme-init.test.ts checks).
(function () {
  let theme = null;
  try {
    theme = window.localStorage.getItem('carehub:theme');
  } catch {
    // Storage blocked (private mode): follow the device.
  }
  const dark =
    theme === 'dark' ||
    (theme !== 'light' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
