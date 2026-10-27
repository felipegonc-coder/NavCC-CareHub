# @carehub/ui

Care Hub's design kit: colour tokens, Tailwind preset, base styles, theme switch, components and logo.
It follows [`docs/plan/look-and-feel.md`](../../docs/plan/look-and-feel.md); the choices are recorded in
[`docs/decisions/0008-design-kit.md`](../../docs/decisions/0008-design-kit.md). The `/design` page in
the web app shows every piece in the current theme.

## Use it

```js
// tailwind.config.js
import preset from '@carehub/ui/tailwind-preset';
export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/*/src/**/*.{ts,tsx}'],
};
```

```tsx
// index.css: @import '@carehub/ui/styles.css';
import { Button, ThemeProvider, ToastProvider } from '@carehub/ui';

<ThemeProvider>
  <ToastProvider>
    <Button>Save</Button>
  </ToastProvider>
</ThemeProvider>;
```

- **Colours:** use the token classes (`bg-bg`, `text-fg`, `text-muted`, `border-border`, `bg-primary`,
  `text-danger` ...), never raw hex. Each is a CSS variable (`--ch-fg`) that flips in dark mode.
  `text-faint` is for placeholders and disabled text only: it is below 4.5:1.
- **Picked colours:** `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`,
  `pink`, `red` (the database option names), for select options, text and block colours and page
  icons. Use `colorClasses[name].text` and `colorClasses[name].bg` (`text-blue-text`, `bg-blue-bg`);
  Tailwind only keeps classes it finds in the source, so do not build them from strings. Outside
  Tailwind: `rgb(var(--ch-blue-text))`. In both themes each text colour keeps 4.5:1 on its own
  background, the page, the sidebar and the fills, and `text-fg` keeps 4.5:1 on every colour
  background; `text-muted` is not checked on them.
- **Covers:** `coverNames` (eight presets, saved as `cover: { type: 'preset', name }`) and
  `style={{ backgroundImage: coverGradients[name] }}`. They are decoration: put no text on them.
- **Sizes and type:** `src/scale.ts` holds the corners, spacing, type, weights, fonts, shadows and
  widths. The Tailwind classes come from it, and so do these CSS variables for plain CSS (the
  editor); change a value there and both follow. Use only these, the classes, or the colour
  variables (`rgb(var(--ch-fg))`): no one-off values.
  - Corners: `--ch-radius-sm` (4px, `rounded-sm`), `--ch-radius` (8px, `rounded`),
    `--ch-radius-full`.
  - Spacing: `--ch-space-<n>` for each Tailwind step (`--ch-space-2` is 0.5rem, like `p-2`;
    `--ch-space-1_5` is step 1.5; also `--ch-space-px`).
  - Type: `--ch-text-<style>` and `--ch-leading-<style>` for `title`, `h1`, `h2`, `h3`, `body`,
    `small`, `label` (`text-small` is `--ch-text-small`); `--ch-weight-<style>` for `title` and
    `h1` to `h3`; `--ch-tracking-title`. Weights `--ch-weight-normal`, `-medium`, `-semibold`,
    `-bold`; fonts `--ch-font-sans`, `--ch-font-mono`.
  - Also `--ch-shadow-menu`, `--ch-shadow-dialog`, widths `--ch-page-width` (48rem),
    `--ch-sidebar-width` (16rem), `--ch-dialog-width` (32rem), `--ch-toast-width` (24rem), and
    `--ch-sheet-height` (85dvh, `max-h-sheet`: how tall a phone's bottom sheet grows). Scrims
    use `bg-overlay/50`; the logo uses `brand` and `brand-fg`; `grid-cols-control` puts a checkbox
    or switch before its label.
- **Checked by lint:** the ESLint rule `carehub/no-one-off-styles` (`lint/no-one-off-styles.js`)
  reads every string, class list and `style={{ }}` object in `apps/web` and `packages`. It flags
  arbitrary values (`rounded-[4px]`, `w-[85vw]`, `max-[900px]:`), Tailwind defaults the kit
  doesn't have (`text-sm`, `font-light`, `bg-gray-100`, `bg-black/50`, `rounded-lg`, `shadow-md`,
  `max-w-lg`), hex and `rgb(0 0 0)` colours, px, rem, em and pt sizes, and px numbers or colour
  names in `style`. Allowed: state and selector variants (`data-[state=open]:`, `has-[:checked]:`,
  `[&>svg]:`), Radix's measured sizes and kit variables in brackets
  (`max-h-[var(--radix-select-content-available-height)]`, `w-[var(--ch-sidebar-width)]`) and
  `transition-[...]` lists. The kit's value files, configs and tests are exempt. It is an error in
  core folders and, until the lanes switch over (decision 0008), a warning in lane folders. If the
  kit lacks a value you need, add it to `src/scale.ts` or `src/tokens.ts` rather than writing it
  inline.
- **Theme:** `ThemeProvider` + `ThemeSwitch` (light, dark, system), saved on the device.
  `apps/web/public/theme-init.js` applies the saved theme before the first paint; it is a file, not
  an inline script, because the Content Security Policy allows only `script-src 'self'`.
- **Phones:** under 768 px every control is at least 44 px tall (`max-md:` classes), as 0007 asks;
  keep that when you override a size. Menus, popovers, select lists and dialogs open as bottom
  sheets there: along the bottom edge, as wide as the screen, over a dimmed page, scrolling once
  they reach `max-h-sheet`. `SheetContent` covers the whole screen.
- **Bigger text:** set `data-text-size="large"` on `<html>`; all sizes are in rem.
- **Fields:** wrap a control in `<Field label hint error required>` and it gets its label, description
  and invalid state for screen readers.
- **Overlays:** `DropdownMenu`, `Dialog`, `Popover`, `Tooltip` (hints only, never the only label)
  and `useToast()` inside `ToastProvider`. Menus, dialogs and popovers close on Escape and give
  focus back. A toast can carry one button, `action: { label: 'Undo', onClick }`; it then stays
  8 seconds instead of 5. Its timer stops while the pointer or keyboard focus is on it, so people
  have time to reach Undo, and a press can come after the server's Undo window. The server then
  answers 409 `conflict`; show a short "Too late to undo" toast.
- **Shell parts:** `SheetContent` (a panel sliding in from the left, inside `Dialog`), and
  `SidebarGroup` and `sidebarRowClasses` for blocks and rows in the sidebar. Below
  `breakpoints.md` (768px, `md:`) the app shell shows the phone layout.
- **Icons:** [Lucide](https://lucide.dev) (`lucide-react`), 16 px inside buttons and menus.
