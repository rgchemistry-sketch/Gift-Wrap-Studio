// Session checks are background reads. Coalesce browser focus/storage events,
// and never let a response started before a login/logout replace the new session.
export function createSessionSynchronizer({ readSession, canCheck, onResult, onError, onSettled }) {
  let generation = 0;
  let active = null;
  let queued = null;

  const invalidate = () => { generation += 1; };

  const check = () => {
    if (!canCheck()) return Promise.resolve();
    if (active) {
      if (active.generation === generation) return active.promise;
      if (!queued) {
        const waiting = active.promise.then(() => {
          if (queued === waiting) queued = null;
          return check();
        });
        queued = waiting;
        const clearQueued = () => {
          if (queued === waiting) queued = null;
        };
        void waiting.then(clearQueued, clearQueued);
      }
      return queued;
    }

    const operation = { generation, promise: null };
    const isCurrent = () => operation.generation === generation && canCheck();
    operation.promise = Promise.resolve()
      .then(readSession)
      .then((result) => {
        if (isCurrent()) onResult(result);
      })
      .catch((error) => {
        if (isCurrent()) onError(error);
      })
      .finally(() => {
        if (active === operation) active = null;
        if (isCurrent()) onSettled();
      });
    active = operation;
    return operation.promise;
  };

  return { check, invalidate };
}

export const sameSessionUser = (previous, next) =>
  previous === next || JSON.stringify(previous || null) === JSON.stringify(next || null);
