# @carehub/ui

Care Hub's design kit: colour tokens, Tailwind preset, base styles, theme switch, components and logo.
It follows [`docs/plan/look-and-feel.md`](../../docs/plan/look-and-feel.md). The `/design` page in the
web app shows every piece in light and dark.

## Use it

```ts
// tailwind.config.ts
import preset from '@carehub/ui/tailwind-preset';
export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
```

```tsx
import '@carehub/ui/styles.css';
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
- **Theme:** `ThemeProvider` + `ThemeToggle` (light, dark, system), saved on the device. Put
  `themeScript` in a `<script>` at the top of `index.html` so the page doesn't flash white.
- **Bigger text:** set `data-text-size="large"` on `<html>`; all sizes are in rem.
- **Fields:** wrap a control in `<Field label hint error required>` and it gets its label, description
  and invalid state for screen readers.
- **Icons:** [Lucide](https://lucide.dev) (`lucide-react`), 16 px inside buttons and menus.
