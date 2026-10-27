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
- **Theme:** `ThemeProvider` + `ThemeSwitch` (light, dark, system), saved on the device.
  `apps/web/public/theme-init.js` applies the saved theme before the first paint; it is a file, not
  an inline script, because the Content Security Policy allows only `script-src 'self'`.
- **Phones:** under 768 px every control is at least 44 px tall (`max-md:` classes), as 0007 asks;
  keep that when you override a size.
- **Bigger text:** set `data-text-size="large"` on `<html>`; all sizes are in rem.
- **Fields:** wrap a control in `<Field label hint error required>` and it gets its label, description
  and invalid state for screen readers.
- **Overlays:** `DropdownMenu`, `Dialog`, `Popover`, `Tooltip` (hints only, never the only label)
  and `useToast()` inside `ToastProvider`. Menus, dialogs and popovers close on Escape and give
  focus back.
- **Shell parts:** `SheetContent` (a panel sliding in from the left, inside `Dialog`), `SidebarGroup`
  and `sidebarRowClasses` for the sidebar, and `usePageTitle('Messages')` for the tab title
  "Care Hub · Messages".
- **Icons:** [Lucide](https://lucide.dev) (`lucide-react`), 16 px inside buttons and menus.
