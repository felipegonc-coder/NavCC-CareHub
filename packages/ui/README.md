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
- **Theme:** `ThemeProvider` + `ThemeSwitch` (light, dark, system), saved on the device.
  `apps/web/public/theme-init.js` applies the saved theme before the first paint; it is a file, not
  an inline script, because the Content Security Policy allows only `script-src 'self'`.
- **Bigger text:** set `data-text-size="large"` on `<html>`; all sizes are in rem.
- **Fields:** wrap a control in `<Field label hint error required>` and it gets its label, description
  and invalid state for screen readers.
- **Icons:** [Lucide](https://lucide.dev) (`lucide-react`), 16 px inside buttons and menus.
