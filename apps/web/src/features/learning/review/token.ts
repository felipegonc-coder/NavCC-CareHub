/** A review link's token: 32 random bytes in base64url, 43 characters (decision 0309). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token of a review link, `/learning/review#<token>`, from the address's fragment, or null. Browsers never
 * send the fragment, so the token stays out of server logs; the screen sends it in a header (0309).
 */
export function reviewTokenFrom(hash: string): string | null {
  const token = hash.startsWith('#') ? hash.slice(1) : hash;
  return TOKEN.test(token) ? token : null;
}
