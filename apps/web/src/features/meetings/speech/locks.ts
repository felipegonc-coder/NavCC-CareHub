import type { Locks } from './types';

/** Web Locks, shared by the browser's tabs. A lock is let go when its tab closes. */
export const webLocks: Locks = {
  tryAcquire: (name) =>
    new Promise((resolve) => {
      navigator.locks
        .request(name, { ifAvailable: true }, (lock) =>
          lock ? new Promise<void>((release) => resolve(() => release())) : resolve(null),
        )
        .catch(() => resolve(null));
    }),
};
