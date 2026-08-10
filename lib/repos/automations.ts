import "server-only";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import {
  parseGraph,
  validateGraph,
  type AutomationGraph,
  type GraphProblem,
} from "@/lib/automation/graph";

export async function listAutomations(ctx: TenantContext) {
  const automations = await db.automation.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { runs: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  const active = await db.automationRun.groupBy({
    by: ["automationId"],
    where: {
      workspaceId: ctx.workspaceId,
      status: { in: ["RUNNING", "WAITING"] },
    },
    _count: true,
  });

  const activeByAutomation = new Map(
    active.map((row) => [row.automationId, row._count]),
  );

  return automations.map((automation) => ({
    ...automation,
    activeRuns: activeByAutomation.get(automation.id) ?? 0,
  }));
}

export async function getAutomation(ctx: TenantContext, automationId: string) {
  return db.automation.findFirst({
    where: { id: automationId, workspaceId: ctx.workspaceId },
    include: {
      versions: { orderBy: { version: "desc" } },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 20,
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
    },
  });
}

/** The graph a new automation starts from: a trigger and one email. */
export function starterGraph(): AutomationGraph {
  return {
    entryNodeId: "trigger",
    nodes: [
      {
        id: "trigger",
        kind: "trigger",
        trigger: "tag_added",
        next: "step-1",
        label: "When a tag is added",
      },
      {
        id: "step-1",
        kind: "send_email",
        subject: "Thanks for getting in touch",
        body: "<p>Hi there — we'll be right with you.</p>",
        next: null,
        label: "Welcome email",
      },
    ],
  };
}

export async function createAutomation(ctx: TenantContext, name: string) {
  const automation = await db.automation.create({
    data: { workspaceId: ctx.workspaceId, name, status: "DRAFT" },
  });

  await db.automationVersion.create({
    data: {
      automationId: automation.id,
      version: 1,
      graph: starterGraph() as unknown as object,
    },
  });

  return automation;
}

/**
 * Save a draft graph.
 *
 * Edits go to the highest unpublished version, or create a new one if the
 * latest is already published — published versions are immutable because runs
 * in flight are still executing them.
 */
export async function saveDraftGraph(
  ctx: TenantContext,
  automationId: string,
  graph: AutomationGraph,
): Promise<{ ok: boolean; problems?: GraphProblem[] }> {
  const automation = await db.automation.findFirst({
    where: { id: automationId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!automation) return { ok: false, problems: [{ message: "Not found" }] };

  const latest = await db.automationVersion.findFirst({
    where: { automationId },
    orderBy: { version: "desc" },
  });

  if (latest && latest.publishedAt === null) {
    await db.automationVersion.update({
      where: { id: latest.id },
      data: { graph: graph as unknown as object },
    });
  } else {
    await db.automationVersion.create({
      data: {
        automationId,
        version: (latest?.version ?? 0) + 1,
        graph: graph as unknown as object,
      },
    });
  }

  await db.automation.update({
    where: { id: automationId },
    data: { updatedAt: new Date() },
  });

  return { ok: true };
}

export async function publishAutomation(
  ctx: TenantContext,
  automationId: string,
): Promise<{ ok: boolean; problems?: GraphProblem[] }> {
  const automation = await db.automation.findFirst({
    where: { id: automationId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!automation) return { ok: false, problems: [{ message: "Not found" }] };

  const latest = await db.automationVersion.findFirst({
    where: { automationId },
    orderBy: { version: "desc" },
  });
  if (!latest) {
    return { ok: false, problems: [{ message: "Nothing to publish" }] };
  }

  const graph = parseGraph(latest.graph);

  // Validate before activating: a broken graph discovered at runtime stalls
  // contacts silently, which nobody notices until the emails stop.
  const problems = validateGraph(graph);
  if (problems.length > 0) return { ok: false, problems };

  await db.automationVersion.update({
    where: { id: latest.id },
    data: { publishedAt: latest.publishedAt ?? new Date() },
  });

  await db.automation.update({
    where: { id: automationId },
    data: { status: "ACTIVE", activeVersionId: latest.id },
  });

  return { ok: true };
}

export async function setAutomationStatus(
  ctx: TenantContext,
  automationId: string,
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
) {
  const result = await db.automation.updateMany({
    where: { id: automationId, workspaceId: ctx.workspaceId },
    data: { status },
  });
  return result.count > 0;
}

export async function automationStats(ctx: TenantContext, automationId: string) {
  const [runs, messages] = await Promise.all([
    db.automationRun.groupBy({
      by: ["status"],
      where: { workspaceId: ctx.workspaceId, automationId },
      _count: true,
    }),
    db.message.count({
      where: {
        workspaceId: ctx.workspaceId,
        automationRun: { automationId },
      },
    }),
  ]);

  return {
    byStatus: Object.fromEntries(
      runs.map((row) => [row.status, row._count]),
    ) as Record<string, number>,
    messagesSent: messages,
  };
}
