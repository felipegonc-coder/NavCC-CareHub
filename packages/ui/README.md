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
import { Button, ThemeProvider } from '@carehub/ui';

<ThemeProvider>
  <Button>Save</Button>
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
  - Also `--ch-shadow-menu`, `--ch-shadow-dialog`, `--ch-page-width` (48rem),
    `--ch-sidebar-width` (16rem). Scrims use `bg-overlay/50`; the logo uses `brand` and
    `brand-fg`.
- **Theme:** `ThemeProvider` + `ThemeSwitch` (light, dark, system), saved on the device.
  `apps/web/public/theme-init.js` applies the saved theme before the first paint; it is a file, not
  an inline script, because the Content Security Policy allows only `script-src 'self'`.
- **Bigger text:** set `data-text-size="large"` on `<html>`; all sizes are in rem.
- **Fields:** wrap a control in `<Field label hint error required>` and it gets its label, description
  and invalid state for screen readers.
- **Icons:** [Lucide](https://lucide.dev) (`lucide-react`), 16 px inside buttons and menus.
