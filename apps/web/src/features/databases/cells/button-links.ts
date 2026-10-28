import { isSafeWebLink } from '@carehub/databases';

/**
 * Opens a link from a button's "Open link" step in a new tab, for whoever runs presses. Only http
 * and https addresses (isSafeWebLink, as URL cells check); the new tab can't reach back to this one
 * (noopener) and isn't told where it came from (noreferrer). Anything else opens nothing and gives
 * false.
 */
export function openButtonLink(url: unknown): boolean {
  if (typeof url !== 'string' || !isSafeWebLink(url)) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
