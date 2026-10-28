// Runs at most `max` tasks at once. The others wait their turn, first come first served, and a
// task that's cancelled while it waits never starts. Calendar reads use it to keep the number
// of fetches and reader workers small, however many subscriptions are due.

/** Runs `task` when a place is free. `signal` cancels it only while it waits. */
export type Limit = <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

export function createLimit(max: number): Limit {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('A limit must be a whole number above 0.');
  }
  let running = 0;
  // Waiting tasks in order. A Set keeps insertion order, and a cancelled task leaves it at once.
  const waiting = new Set<() => void>();
  const startNext = () => {
    const [next] = waiting;
    if (next && running < max) {
      waiting.delete(next);
      next();
    }
  };
  return <T>(task: () => Promise<T>, signal?: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', cancel);
        running++;
        let result: Promise<T>;
        try {
          result = task();
        } catch (error) {
          result = Promise.reject(error);
        }
        void result.then(resolve, reject).finally(() => {
          running--;
          startNext();
        });
      };
      const cancel = () => {
        waiting.delete(start);
        reject(signal?.reason);
      };
      if (signal?.aborted) {
        reject(signal.reason);
      } else if (running < max) {
        start();
      } else {
        waiting.add(start);
        signal?.addEventListener('abort', cancel, { once: true });
      }
    });
}
