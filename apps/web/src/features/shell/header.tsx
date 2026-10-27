import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeaderTargetContext } from './header-context';

/**
 * Puts a screen's breadcrumbs and buttons in the shell's top bar, next to the phone menu button.
 * Render it anywhere in the screen; it shows nothing outside the shell.
 */
export function ShellHeader({ children }: { children: ReactNode }) {
  const target = useContext(HeaderTargetContext);
  return target ? createPortal(children, target) : null;
}
