import "server-only";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { sendMessage } from "@/lib/messaging/send";
import type { ContactSnapshot } from "@/lib/segments/evaluate";
import { advanceRun, type Effect, type StepContext } from "./step";
import { parseGraph, type AutomationGraph, type TriggerKind } from "./graph";

/**
 * The thin, impure half of the automation engine.
 *
 * All the branching logic lives in `step.ts` and is unit-tested; this file
 * loads state, calls the reducer, and writes what came back.
 */

export interface RunOptions {
  now?: Date;
  random?: () => number;
}

async function loadSnapshot(
  contactId: string,
): Promise<{ snapshot: ContactSnapshot; timezone: string | null } | null> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      tags: { select: { tagId: true } },
      lists: { select: { listId: true } },
      fieldValues: { include: { field: { select: { key: true } } } },
    },
  });
  if (!contact) return null;

  return {
    timezone: contact.timezone,
    snapshot: {
      email: contact.email,
      phone: contact.phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      jobTitle: contact.jobTitle,
      source: contact.source,
      timezone: contact.timezone,
      status: contact.status,
      ownerUserId: contact.ownerUserId,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      lastActivityAt: contact.lastActivityAt,
      tagIds: contact.tags.map((link) => link.tagId),
      listIds: contact.lists.map((link) => link.listId),
      customFields: Object.fromEntries(
        contact.fieldValues.map((value) => [value.field.key, value.value]),
      ),
    },
  };
}

/**
 * Put a contact into an automation.
 *
 * Re-entry is refused unless the automation opts in, which is what stops a
 * contact who re-submits a form from receiving the whole welcome sequence a
 * second time.
 */
export async function enrollContact(
  automationId: string,
  contactId: string,
  context: Record<string, unknown> = {},
): Promise<string | null> {
  const automation = await db.automation.findUnique({
    where: { id: automationId },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      allowReentry: true,
      activeVersionId: true,
    },
  });

  if (!automation || automation.status !== "ACTIVE") return null;
  if (!automation.activeVersionId) return null;

  if (!automation.allowReentry) {
    const existing = await db.automationRun.findFirst({
      where: { automationId, contactId },
      select: { id: true },
    });
    if (existing) return null;
  } else {
    // Even with re-entry allowed, never run the same contact twice at once.
    const inFlight = await db.automationRun.findFirst({
      where: {
        automationId,
        contactId,
        status: { in: ["RUNNING", "WAITING"] },
      },
      select: { id: true },
    });
    if (inFlight) return null;
  }

  const version = await db.automationVersion.findUnique({
    where: { id: automation.activeVersionId },
    select: { id: true, graph: true },
  });
  if (!version) return null;

  const graph = parseGraph(version.graph);

  const run = await db.automationRun.create({
    data: {
      workspaceId: automation.workspaceId,
      automationId,
      versionId: version.id,
      contactId,
      currentNodeId: graph.entryNodeId,
      status: "RUNNING",
      context: context as object,
    },
    select: { id: true },
  });

  await enqueue(
    "automation.advance",
    { runId: run.id },
    { workspaceId: automation.workspaceId },
  );

  return run.id;
}

/** Enroll every contact matching a trigger event. */
export async function fireTrigger(
  workspaceId: string,
  trigger: TriggerKind,
  contactId: string,
  context: Record<string, unknown> = {},
): Promise<number> {
  const automations = await db.automation.findMany({
    where: { workspaceId, status: "ACTIVE" },
    select: { id: true, activeVersionId: true },
  });

  let enrolled = 0;

  for (const automation of automations) {
    if (!automation.activeVersionId) continue;

    const version = await db.automationVersion.findUnique({
      where: { id: automation.activeVersionId },
      select: { graph: true },
    });
    if (!version) continue;

    let graph: AutomationGraph;
    try {
      graph = parseGraph(version.graph);
    } catch {
      continue;
    }

    const entry = graph.nodes.find((node) => node.id === graph.entryNodeId);
    if (!entry || entry.kind !== "trigger" || entry.trigger !== trigger) {
      continue;
    }

    const runId = await enrollContact(automation.id, contactId, context);
    if (runId) enrolled += 1;
  }

  return enrolled;
}

/** Advance one run as far as it will go, then persist where it stopped. */
export async function advanceAutomationRun(
  runId: string,
  options: RunOptions = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  const run = await db.automationRun.findUnique({
    where: { id: runId },
    include: {
      version: { select: { graph: true } },
      automation: { select: { status: true } },
    },
  });

  if (!run || run.status === "COMPLETED" || run.status === "EXITED") return;

  // A paused automation stops advancing but keeps its runs, so resuming
  // continues rather than restarting.
  if (run.automation.status === "PAUSED") return;

  if (!run.currentNodeId) {
    await db.automationRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", endedAt: now },
    });
    return;
  }

  const loaded = await loadSnapshot(run.contactId);
  if (!loaded) {
    await db.automationRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        lastError: "Contact no longer exists",
        endedAt: now,
      },
    });
    return;
  }

  const graph = parseGraph(run.version.graph);

  const ctx: StepContext = {
    now,
    contact: loaded.snapshot,
    timeZone: loaded.timezone ?? "America/New_York",
    random: random(),
  };

  const result = advanceRun(graph, run.currentNodeId, ctx);

  for (const nodeId of result.visited) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    await db.automationRunStep.create({
      data: { runId, nodeId, nodeKind: node?.kind ?? "unknown" },
    });
  }

  for (const effect of result.effects) {
    await applyEffect(effect, {
      workspaceId: run.workspaceId,
      contactId: run.contactId,
      runId,
    });
  }

  const terminal =
    result.status === "COMPLETED" ||
    result.status === "EXITED" ||
    result.status === "FAILED";

  await db.automationRun.update({
    where: { id: runId },
    data: {
      currentNodeId: result.nextNodeId,
      status: result.status,
      resumeAt: result.resumeAt,
      lastError: result.reason ?? null,
      endedAt: terminal ? now : null,
    },
  });

  if (result.status === "WAITING" && result.resumeAt) {
    await enqueue(
      "automation.advance",
      { runId },
      { workspaceId: run.workspaceId, runAt: result.resumeAt },
    );
  }
}

interface EffectContext {
  workspaceId: string;
  contactId: string;
  runId: string;
}

async function applyEffect(
  effect: Effect,
  ctx: EffectContext,
): Promise<void> {
  switch (effect.type) {
    case "send_email":
      await sendMessage({
        workspaceId: ctx.workspaceId,
        contactId: ctx.contactId,
        channel: "EMAIL",
        subject: effect.subject,
        body: effect.body,
        transactional: effect.transactional,
        automationRunId: ctx.runId,
      });
      return;

    case "send_sms":
      await sendMessage({
        workspaceId: ctx.workspaceId,
        contactId: ctx.contactId,
        channel: "SMS",
        body: effect.body,
        transactional: effect.transactional,
        automationRunId: ctx.runId,
      });
      return;

    case "add_tag":
      await db.contactTag
        .create({ data: { contactId: ctx.contactId, tagId: effect.tagId } })
        // Already tagged is not an error.
        .catch(() => null);
      return;

    case "remove_tag":
      await db.contactTag.deleteMany({
        where: { contactId: ctx.contactId, tagId: effect.tagId },
      });
      return;

    case "update_field":
      await applyFieldUpdate(ctx, effect.field, effect.value);
      return;

    case "create_task":
      await db.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          contactId: ctx.contactId,
          title: effect.title,
          dueAt: effect.dueAt,
          assigneeUserId: effect.assigneeUserId,
        },
      });
      return;

    case "notify_team":
      await db.activity.create({
        data: {
          workspaceId: ctx.workspaceId,
          contactId: ctx.contactId,
          type: "SYSTEM",
          title: effect.message,
        },
      });
      return;

    case "webhook":
      // Outbound HTTP is retried independently of the run, so a slow endpoint
      // cannot stall the sequence.
      await enqueue(
        "webhook.deliver",
        {
          url: effect.url,
          method: effect.method,
          workspaceId: ctx.workspaceId,
          contactId: ctx.contactId,
        },
        { workspaceId: ctx.workspaceId },
      );
      return;

    case "record_split":
      await db.automationRunStep.create({
        data: {
          runId: ctx.runId,
          nodeId: effect.nodeId,
          nodeKind: "split",
          output: { branchId: effect.branchId },
        },
      });
      return;

    case "goal_reached":
      await db.automationRunStep.create({
        data: {
          runId: ctx.runId,
          nodeId: effect.nodeId,
          nodeKind: "goal",
          output: { reached: true },
        },
      });
      return;
  }
}

const WRITABLE_CONTACT_FIELDS = new Set([
  "firstName",
  "lastName",
  "company",
  "jobTitle",
  "source",
  "status",
  "timezone",
]);

async function applyFieldUpdate(
  ctx: EffectContext,
  field: string,
  value: string | number | boolean | null,
): Promise<void> {
  if (field.startsWith("custom:")) {
    const key = field.slice("custom:".length);
    const customField = await db.customField.findUnique({
      where: { workspaceId_key: { workspaceId: ctx.workspaceId, key } },
      select: { id: true },
    });
    if (!customField) return;

    // Scalars are valid JSON; the cast goes through `unknown` because Prisma's
    // input type is written for objects.
    const json = value as unknown as object;

    await db.contactFieldValue.upsert({
      where: {
        contactId_fieldId: {
          contactId: ctx.contactId,
          fieldId: customField.id,
        },
      },
      update: { value: json },
      create: {
        contactId: ctx.contactId,
        fieldId: customField.id,
        value: json,
      },
    });
    return;
  }

  // Allow-list: an automation must not be able to write arbitrary columns.
  if (!WRITABLE_CONTACT_FIELDS.has(field)) return;

  await db.contact.update({
    where: { id: ctx.contactId },
    data: { [field]: value },
  });
}
