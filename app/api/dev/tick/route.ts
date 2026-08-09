import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registerJobHandlers } from "@/lib/jobs/handlers";
import { drainJobs } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";

/**
 * Development time travel.
 *
 * A welcome sequence with a three-day wait is untestable in real time. This
 * pulls every pending job's `runAt` into the past and drains the queue, so a
 * multi-day automation can be walked end to end in seconds.
 *
 * Development only — it would let anyone force-send a client's entire schedule.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "7");
  const shift = Number.isFinite(days) ? days : 7;

  const now = new Date();
  const horizon = new Date(now.getTime() + shift * 86_400_000);

  // Pull anything due within the horizon back to now, including automation
  // runs parked on a long wait.
  const advanced = await db.job.updateMany({
    where: { completedAt: null, failedAt: null, runAt: { lte: horizon } },
    data: { runAt: now },
  });

  await db.automationRun.updateMany({
    where: { status: "WAITING", resumeAt: { lte: horizon } },
    data: { resumeAt: now },
  });

  registerJobHandlers();

  // Several passes: one job commonly enqueues the next step of a sequence.
  const rounds = [];
  for (let round = 0; round < 5; round += 1) {
    const result = await drainJobs({ limit: 100 });
    rounds.push(result);
    if (result.claimed === 0) break;
  }

  return NextResponse.json({
    ok: true,
    shiftedDays: shift,
    jobsAdvanced: advanced.count,
    rounds,
  });
}
