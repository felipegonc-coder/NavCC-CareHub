/** Row writes the table has in flight at once. */
export const WRITES_AT_ONCE = 4;

/**
 * Sends writes a few at a time, in the order they come, so a big paste doesn't fire hundreds of
 * requests at once and a later change to a row goes out after an earlier one. A task starts at
 * once while fewer than `limit` are running; the promise settles as the task's does.
 */
export function writeQueue(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const startNext = () => {
    while (running < limit) {
      const start = waiting.shift();
      if (!start) return;
      running += 1;
      start();
    }
  };
  return function queue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        let result: Promise<T>;
        try {
          result = task();
        } catch (error) {
          result = Promise.reject(error);
        }
        void result.then(resolve, reject).finally(() => {
          running -= 1;
          startNext();
        });
      });
      startNext();
    });
  };
}
