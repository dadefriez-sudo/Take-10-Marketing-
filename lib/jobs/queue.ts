import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * A Postgres-backed job queue.
 *
 * Automations wait days between steps, reminders fire at a fixed hour, and a
 * provider outage has to be retried — none of which survives in memory. Rows
 * are claimed with `FOR UPDATE SKIP LOCKED`, so several workers can drain the
 * same table without coordinating and without handing the same job out twice.
 *
 * Deliberately not a queue vendor: this runs anywhere Postgres does, is
 * testable offline, and can be swapped for Inngest later behind `enqueue()`.
 * The trade-off is minute-granularity scheduling, which is fine for marketing
 * automation and is not fine for anything latency-sensitive.
 */

/** A lock older than this is treated as a dead worker and reclaimed. */
export const LOCK_TIMEOUT_MS = 5 * 60_000;

export const DEFAULT_MAX_ATTEMPTS = 5;

export interface EnqueueOptions {
  workspaceId?: string | null;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Makes enqueueing safe to repeat. A second enqueue with the same key is
   * ignored rather than producing a duplicate send.
   */
  idempotencyKey?: string;
}

export interface JobRow {
  id: string;
  workspaceId: string | null;
  type: string;
  payload: unknown;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const data = {
    type,
    payload: payload as object,
    workspaceId: options.workspaceId ?? null,
    runAt: options.runAt ?? new Date(),
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    idempotencyKey: options.idempotencyKey ?? null,
  };

  if (!options.idempotencyKey) {
    const job = await db.job.create({ data, select: { id: true } });
    return job.id;
  }

  try {
    const job = await db.job.create({ data, select: { id: true } });
    return job.id;
  } catch (error) {
    // Unique violation on idempotencyKey — the work is already scheduled.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Atomically claim up to `limit` due jobs.
 *
 * The UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) shape is what makes
 * this safe under concurrency: the inner select takes row locks and skips rows
 * another worker already holds, so no job is handed out twice.
 */
export async function claimDueJobs(
  limit: number,
  workerId: string,
  now: Date = new Date(),
): Promise<JobRow[]> {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS);

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      workspaceId: string | null;
      type: string;
      payload: unknown;
      runAt: Date;
      attempts: number;
      maxAttempts: number;
    }>
  >`
    UPDATE "Job" AS j
    SET "lockedAt" = ${now}, "lockedBy" = ${workerId}, attempts = j.attempts + 1
    FROM (
      SELECT id
      FROM "Job"
      WHERE "completedAt" IS NULL
        AND "failedAt" IS NULL
        AND "runAt" <= ${now}
        AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE j.id = due.id
    RETURNING j.id, j."workspaceId", j.type, j.payload, j."runAt",
              j.attempts, j."maxAttempts"
  `;

  return rows;
}

export async function completeJob(jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { completedAt: new Date(), lockedAt: null, lockedBy: null },
  });
}

/** Exponential backoff with a ceiling, so a failing provider is not hammered. */
export function backoffDelayMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 15 * 60_000);
}

export async function failJob(
  jobId: string,
  error: unknown,
  now: Date = new Date(),
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });
  if (!job) return;

  const exhausted = job.attempts >= job.maxAttempts;

  await db.job.update({
    where: { id: jobId },
    data: {
      lastError: message.slice(0, 4000),
      lockedAt: null,
      lockedBy: null,
      ...(exhausted
        ? { failedAt: now }
        : { runAt: new Date(now.getTime() + backoffDelayMs(job.attempts)) }),
    },
  });
}

export async function queueStats(workspaceId?: string) {
  const scope = workspaceId ? { workspaceId } : {};
  const [pending, failed, completed] = await Promise.all([
    db.job.count({ where: { ...scope, completedAt: null, failedAt: null } }),
    db.job.count({ where: { ...scope, failedAt: { not: null } } }),
    db.job.count({ where: { ...scope, completedAt: { not: null } } }),
  ]);
  return { pending, failed, completed };
}
