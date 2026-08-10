import { NextResponse } from "next/server";
import { registerJobHandlers } from "@/lib/jobs/handlers";
import { drainJobs } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The heartbeat. Vercel Cron calls this every minute; it claims a batch of due
 * jobs and runs them.
 *
 * Batched rather than looping so one invocation has a bounded cost — a runaway
 * loop in a serverless function is a billing incident, and any work left over
 * is simply picked up on the next tick.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Refuse to run unauthenticated in production rather than exposing a
    // public endpoint that drains the queue.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  registerJobHandlers();
  const result = await drainJobs({ limit: 50 });

  return NextResponse.json({
    ok: true,
    ...result,
    at: new Date().toISOString(),
  });
}
