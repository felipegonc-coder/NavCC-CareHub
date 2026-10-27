// Vite's import.meta.glob, as the tests use it (vite/client types aren't loaded here).
interface ImportMeta {
  glob(
    patterns: string | string[],
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
