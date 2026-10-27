import { createContext } from 'react';

/** The top bar's empty area, which <ShellHeader> fills. Null outside the shell. */
export const HeaderTargetContext = createContext<HTMLElement | null>(null);
