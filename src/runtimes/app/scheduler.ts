export interface SchedulerTask {
  /** `${owner}/${repo}#${pullRequestNumber}`; a new task for the same key aborts the previous one. */
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
}

export interface Scheduler {
  enqueue(task: SchedulerTask): void;
}

export interface CreateSchedulerInput {
  /** Maximum number of tasks executing at once, across all keys. */
  maxConcurrent: number;
  onError?: (key: string, error: unknown) => void;
}

/**
 * In-memory latest-wins scheduler keyed by `${owner}/${repo}#${pullRequestNumber}`.
 * Enqueuing a task for a key already running (or queued) aborts the previous
 * controller for that key before starting the new one, so an older webhook
 * delivery for the same PR is always superseded rather than racing to write
 * comments after a newer one. There is no durable queue: a process restart
 * loses in-flight and queued tasks (design doc section 4).
 */
export function createScheduler(input: CreateSchedulerInput): Scheduler {
  const controllers = new Map<string, AbortController>();
  const queue: Array<() => void> = [];
  let running = 0;

  function runNext(): void {
    if (running >= input.maxConcurrent) {
      return;
    }
    const next = queue.shift();
    if (!next) {
      return;
    }
    running += 1;
    next();
  }

  return {
    enqueue(task: SchedulerTask): void {
      controllers.get(task.key)?.abort();

      const controller = new AbortController();
      controllers.set(task.key, controller);

      queue.push(() => {
        task
          .run(controller.signal)
          .catch((error: unknown) => {
            input.onError?.(task.key, error);
          })
          .finally(() => {
            if (controllers.get(task.key) === controller) {
              controllers.delete(task.key);
            }
            running -= 1;
            runNext();
          });
      });

      runNext();
    }
  };
}
