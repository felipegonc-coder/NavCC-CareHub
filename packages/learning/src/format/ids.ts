const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 16;
// Bytes at or above this are skipped so every character is equally likely (248 = 4 × 62).
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

type Crypto = { getRandomValues<T extends Uint8Array>(array: T): T };

/** A random 16-character id of letters and digits (crypto.getRandomValues). It always matches the id pattern. */
export function newId(): string {
  const crypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!crypto)
    throw new Error(
      'newId needs crypto.getRandomValues (every supported browser and Node version has it).',
    );
  let id = '';
  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ID_LENGTH * 2))) {
      if (byte < UNBIASED_LIMIT && id.length < ID_LENGTH)
        id += ALPHABET.charAt(byte % ALPHABET.length);
    }
  }
  return id;
}
