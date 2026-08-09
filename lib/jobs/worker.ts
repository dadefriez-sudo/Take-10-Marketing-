import "server-only";
import { randomUUID } from "node:crypto";
import { claimDueJobs, completeJob, failJob, type JobRow } from "./queue";

export type JobHandler = (
  payload: Record<string, unknown>,
  job: JobRow,
) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()];
}

export interface DrainResult {
  claimed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ jobId: string; type: string; message: string }>;
}

/**
 * Claim and run one batch of due jobs.
 *
 * Called by the cron route each minute and by tests directly. Returns rather
 * than looping forever so the caller controls the time budget — a serverless
 * invocation has one, and a runaway loop there is a billing incident.
 */
export async function drainJobs({
  limit = 25,
  now = new Date(),
  workerId = `worker-${randomUUID()}`,
}: {
  limit?: number;
  now?: Date;
  workerId?: string;
} = {}): Promise<DrainResult> {
  const jobs = await claimDueJobs(limit, workerId, now);

  const result: DrainResult = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const job of jobs) {
    const handler = handlers.get(job.type);

    if (!handler) {
      result.failed += 1;
      result.errors.push({
        jobId: job.id,
        type: job.type,
        message: `No handler registered for job type "${job.type}"`,
      });
      await failJob(job.id, new Error(`No handler for "${job.type}"`), now);
      continue;
    }

    try {
      await handler((job.payload ?? {}) as Record<string, unknown>, job);
      await completeJob(job.id);
      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        jobId: job.id,
        type: job.type,
        message: error instanceof Error ? error.message : String(error),
      });
      // One bad job must not stop the batch; it gets its own backoff.
      await failJob(job.id, error, now);
    }
  }

  return result;
}
