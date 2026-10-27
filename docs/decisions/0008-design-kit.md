# 0008: Design kit (`@carehub/ui`)

- **Status:** accepted (2026-10-26). The lead approved the `#707070` change and the CSP approach.
- **Context:** Every screen needs the same colours, type, focus rings and components in light and
  dark mode, readable at WCAG 2.2 AA, under a Content Security Policy of `script-src 'self'`.
  `docs/plan/look-and-feel.md` gives the palette and type.
- **Decision:**
  - **Tokens:** 19 named colours in `packages/ui/src/tokens.ts`: `bg fg muted faint border
    border-hover sidebar fill fill-hover primary primary-fg primary-hover danger success warning
    ring overlay brand brand-fg`. The Tailwind preset writes each as a CSS variable `--ch-<name>`
    holding RGB channels (`10 10 10`) under `:root` (light) and `.dark`, and maps the Tailwind
    colour of the same name to `rgb(var(--ch-<name>) / <alpha-value>)`, so opacity modifiers work.
    Code uses token classes, never raw hex.
  - **Contrast:** light `muted` is `#707070`, not the spec's `#737373`, which is only 4.35:1 on the
    `#F5F5F5` hover fill; `#707070` keeps 4.5:1 on every surface. `faint` (`#A3A3A3` light,
    `#737373` dark) is for placeholders and disabled text only. Where the spec only says "readable":
    danger `#B91C1C` / `#F87171`, success `#15803D` / `#4ADE80`, warning `#B45309` / `#FBBF24`,
    focus ring `#2563EB` / `#60A5FA`, dark hover fill `#303030`, dark primary hover `#E5E5E5`.
    `tokens.test.ts` checks text at 4.5:1 and the ring at 3:1 on every surface in both themes.
  - **Type and shape:** system font stack with colour emoji; `text-title` 36 bold, `text-h1` to
    `text-h3` 30, 24 and 20 semibold (headings in pages), `text-body` 16, `text-small` 14,
    `text-label` 12, all in rem, so `data-text-size="large"` on `<html>` scales everything; 8 px
    corners (4 px for small parts); `max-w-page` 48rem; `w-sidebar` 16rem.
  - **One source for sizes:** corners, spacing, type, weights, fonts, shadows and widths live in
    `packages/ui/src/scale.ts`. The preset builds the Tailwind classes from it and writes the same
    values as CSS variables (`--ch-radius`, `--ch-space-<n>`, `--ch-text-<style>` ...) for plain
    CSS such as the editor. Code uses these or the token classes, never one-off values, so the
    look can be changed in one place.
  - **Checked by lint (2026-10-27):** the ESLint rule `carehub/no-one-off-styles`
    (`packages/ui/lint/`) reads strings, class lists and `style` objects in `apps/web` and
    `packages`. It flags arbitrary Tailwind values, Tailwind defaults the kit doesn't define (font
    sizes, thin, light and extra-bold weights, palette colours, black and white, larger corners,
    shadows, named max widths), hex and numeric `rgb()` colours, px, rem, em and pt sizes, and px
    numbers and colour names in `style`. State variants, Radix's measured sizes, kit variables and
    transition lists are allowed. It is an error in core folders and a warning in lane folders
    until 2026-10-29, then an error there too (`scripts/lint.mjs` lets the lane warnings pass until
    then). CSS files aren't linted.
  - **Theme:** light, dark or system (the default), saved on the device in `localStorage` under
    `carehub:theme`. The `dark` class on `<html>` switches every variable. `ThemeProvider` follows
    the device and other tabs live; `ThemeSwitch` is three native radio buttons.
  - **CSP, no inline script:** `apps/web/public/theme-init.js` is loaded synchronously (classic
    script, no `defer`) at the top of `<head>` and applies the saved theme before the first paint,
    so dark mode doesn't flash white. It repeats the storage key and media query;
    `apps/web/src/theme-init.test.ts` fails if they drift from `@carehub/ui`.
  - **Components and icons:** Radix primitives for keyboard, focus and ARIA behaviour, styled with
    the tokens. Icons are Lucide; `lucide-react` (ISC) is pinned to `~0.577.0`, the last 0.x line.
    Moving to 1.x is a separate change.
- **Consequences:** A new colour goes into `tokens.ts` for both themes and must pass the contrast
  test; any other missing value goes into `scale.ts`, never inline. Changing the storage key means changing `theme-init.js` too; the test catches a mismatch.
  The theme file costs one small cached request before first paint. Menus, dialogs, toasts,
  tooltips and popovers follow in a separate pull request.
