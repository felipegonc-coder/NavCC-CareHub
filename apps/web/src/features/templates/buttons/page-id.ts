// Which page a button is on. Buttons need it for every call: who may press, Can edit for Insert
// blocks, locked, archived and Trash are all about the page (spec 3.4).
import { createContext, useContext } from 'react';
import { useLocation } from 'react-router';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page ID in an address like `/p/<pageId>` (`pageUrl` in @carehub/shared), or null. */
export function pageIdFromPath(pathname: string): string | null {
  const id = /^\/p\/([^/?#]+)/.exec(pathname)?.[1] ?? '';
  return UUID.test(id) ? id : null;
}

/** A page's ID from a pasted link (`/p/<id>`, a full address) or the ID itself; null otherwise. */
export function pageIdFromLink(text: string): string | null {
  const value = text.trim();
  if (UUID.test(value)) return value;
  try {
    return pageIdFromPath(new URL(value, 'https://care-hub.invalid').pathname);
  } catch {
    return null;
  }
}

/**
 * The page view may say which page its editor shows (a page in the side panel isn't the one in
 * the address). Otherwise it's the page in the address. Null on share-link pages and anywhere
 * else without a page, where buttons are hidden.
 */
const ButtonPageContext = createContext<string | null | undefined>(undefined);
export const ButtonPageProvider = ButtonPageContext.Provider;

export function useButtonPageId(): string | null {
  const given = useContext(ButtonPageContext);
  const { pathname } = useLocation();
  return given === undefined ? pageIdFromPath(pathname) : given;
}
