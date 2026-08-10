import { evaluateSegment, type ContactSnapshot } from "@/lib/segments/evaluate";
import { toZonedParts, zonedPartsToInstant } from "@/lib/messaging/guard";
import {
  AutomationGraphError,
  findNode,
  type AutomationGraph,
  type AutomationNode,
} from "./graph";

/**
 * The automation runtime, as a pure function.
 *
 * `step` takes a node and a snapshot of the world and returns the effects to
 * apply plus where to go next. It performs no I/O, which is the whole point:
 * every node kind, every branch, and every wait-resumption path can be tested
 * exhaustively in milliseconds, and the DB driver in `run.ts` stays thin enough
 * to read in one sitting.
 */

export type Effect =
  | { type: "send_email"; subject: string; body: string; transactional: boolean }
  | { type: "send_sms"; body: string; transactional: boolean }
  | { type: "add_tag"; tagId: string }
  | { type: "remove_tag"; tagId: string }
  | { type: "update_field"; field: string; value: string | number | boolean | null }
  | { type: "create_task"; title: string; dueAt: Date | null; assigneeUserId: string | null }
  | { type: "notify_team"; message: string }
  | { type: "webhook"; url: string; method: "POST" | "GET" }
  | { type: "record_split"; nodeId: string; branchId: string }
  | { type: "goal_reached"; nodeId: string };

export type RunStatus = "RUNNING" | "WAITING" | "COMPLETED" | "EXITED" | "FAILED";

export interface StepContext {
  now: Date;
  contact: ContactSnapshot;
  /** The contact's zone if known, otherwise the workspace's. */
  timeZone: string;
  /**
   * Deterministic in tests, `Math.random()` in production. Only consumed by
   * split nodes.
   */
  random: number;
}

export interface StepResult {
  effects: Effect[];
  /** Where the run continues. `null` means there is nowhere left to go. */
  nextNodeId: string | null;
  status: RunStatus;
  /** Set when status is WAITING. */
  resumeAt: Date | null;
  /** Populated when status is EXITED or FAILED. */
  reason?: string;
}

const MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

export function step(node: AutomationNode, ctx: StepContext): StepResult {
  switch (node.kind) {
    case "trigger":
      // The trigger is an entry marker; entering the automation is the work.
      return advance(node.next ?? null, []);

    case "send_email":
      return advance(node.next ?? null, [
        {
          type: "send_email",
          subject: node.subject,
          body: node.body,
          transactional: node.transactional ?? false,
        },
      ]);

    case "send_sms":
      return advance(node.next ?? null, [
        {
          type: "send_sms",
          body: node.body,
          transactional: node.transactional ?? false,
        },
      ]);

    case "add_tag":
      return advance(node.next ?? null, [
        { type: "add_tag", tagId: node.tagId },
      ]);

    case "remove_tag":
      return advance(node.next ?? null, [
        { type: "remove_tag", tagId: node.tagId },
      ]);

    case "update_field":
      return advance(node.next ?? null, [
        { type: "update_field", field: node.field, value: node.value },
      ]);

    case "create_task":
      return advance(node.next ?? null, [
        {
          type: "create_task",
          title: node.title,
          dueAt:
            node.dueInDays === undefined
              ? null
              : new Date(ctx.now.getTime() + node.dueInDays * MS.days),
          assigneeUserId: node.assigneeUserId ?? null,
        },
      ]);

    case "notify_team":
      return advance(node.next ?? null, [
        { type: "notify_team", message: node.message },
      ]);

    case "webhook":
      return advance(node.next ?? null, [
        { type: "webhook", url: node.url, method: node.method ?? "POST" },
      ]);

    case "wait":
      return waitStep(node, ctx);

    case "condition": {
      const matched = evaluateSegment(node.predicate, ctx.contact, {
        now: ctx.now,
      });
      return advance(matched ? node.onTrue : node.onFalse, []);
    }

    case "split":
      return splitStep(node, ctx);

    case "goal": {
      const reached = evaluateSegment(node.predicate, ctx.contact, {
        now: ctx.now,
      });
      if (reached) {
        return advance(node.onReached, [
          { type: "goal_reached", nodeId: node.id },
        ]);
      }
      return advance(node.next ?? null, []);
    }

    case "exit":
      return {
        effects: [],
        nextNodeId: null,
        status: "EXITED",
        resumeAt: null,
        reason: node.reason ?? "Reached an exit step",
      };

    default: {
      const unreachable = node as AutomationNode;
      throw new AutomationGraphError(
        `Unknown step kind "${(unreachable as { kind: string }).kind}"`,
      );
    }
  }
}

function advance(nextNodeId: string | null, effects: Effect[]): StepResult {
  return {
    effects,
    nextNodeId,
    // No next node means the sequence ran to its end, which is success.
    status: nextNodeId === null ? "COMPLETED" : "RUNNING",
    resumeAt: null,
  };
}

function waitStep(
  node: Extract<AutomationNode, { kind: "wait" }>,
  ctx: StepContext,
): StepResult {
  const resumeAt =
    node.untilHour !== undefined
      ? nextLocalHour(ctx.now, ctx.timeZone, node.untilHour)
      : new Date(ctx.now.getTime() + node.amount! * MS[node.unit!]);

  // The run resumes *after* the wait, so the pointer moves on now and the
  // clock decides when it is read again.
  const nextNodeId = node.next ?? null;

  return {
    effects: [],
    nextNodeId,
    status: nextNodeId === null ? "COMPLETED" : "WAITING",
    resumeAt: nextNodeId === null ? null : resumeAt,
  };
}

/** The next occurrence of `hour` local time, strictly in the future. */
export function nextLocalHour(
  now: Date,
  timeZone: string,
  hour: number,
): Date {
  const parts = toZonedParts(now, timeZone);

  const today = zonedPartsToInstant({ ...parts, hour, minute: 0 }, timeZone);
  if (today.getTime() > now.getTime()) return today;

  const tomorrowParts = toZonedParts(
    new Date(now.getTime() + 86_400_000),
    timeZone,
  );
  return zonedPartsToInstant(
    { ...tomorrowParts, hour, minute: 0 },
    timeZone,
  );
}

function splitStep(
  node: Extract<AutomationNode, { kind: "split" }>,
  ctx: StepContext,
): StepResult {
  const total = node.branches.reduce((sum, branch) => sum + branch.weight, 0);

  if (total <= 0) {
    return {
      effects: [],
      nextNodeId: null,
      status: "FAILED",
      resumeAt: null,
      reason: `Split "${node.id}" has no positive branch weights`,
    };
  }

  // Clamp rather than trust: a random of exactly 1 would otherwise fall past
  // the last branch and strand the run.
  const roll = Math.min(Math.max(ctx.random, 0), 0.999_999_999) * total;

  let cursor = 0;
  for (const branch of node.branches) {
    cursor += branch.weight;
    if (roll < cursor) {
      return {
        effects: [
          { type: "record_split", nodeId: node.id, branchId: branch.id },
        ],
        nextNodeId: branch.next,
        status: branch.next === null ? "COMPLETED" : "RUNNING",
        resumeAt: null,
      };
    }
  }

  const last = node.branches[node.branches.length - 1]!;
  return {
    effects: [{ type: "record_split", nodeId: node.id, branchId: last.id }],
    nextNodeId: last.next,
    status: last.next === null ? "COMPLETED" : "RUNNING",
    resumeAt: null,
  };
}

export interface AdvanceResult {
  effects: Effect[];
  visited: string[];
  status: RunStatus;
  nextNodeId: string | null;
  resumeAt: Date | null;
  reason?: string;
}

/**
 * Run a graph from a node until it waits or terminates, collecting effects.
 *
 * `maxSteps` is a cycle guard: a graph that loops without a wait (a goal
 * pointing back at itself, say) would otherwise spin forever inside one job.
 */
export function advanceRun(
  graph: AutomationGraph,
  startNodeId: string,
  ctx: StepContext,
  maxSteps = 50,
): AdvanceResult {
  const effects: Effect[] = [];
  const visited: string[] = [];

  let currentId: string | null = startNodeId;
  let steps = 0;

  while (currentId !== null) {
    if (steps++ >= maxSteps) {
      return {
        effects,
        visited,
        status: "FAILED",
        nextNodeId: currentId,
        resumeAt: null,
        reason: `Automation ran ${maxSteps} steps without pausing — check for a loop without a wait`,
      };
    }

    const node: AutomationNode | undefined = findNode(graph, currentId);
    if (!node) {
      return {
        effects,
        visited,
        status: "FAILED",
        nextNodeId: null,
        resumeAt: null,
        reason: `Step "${currentId}" is missing from the graph`,
      };
    }

    visited.push(node.id);
    const result = step(node, ctx);
    effects.push(...result.effects);

    if (result.status !== "RUNNING") {
      return {
        effects,
        visited,
        status: result.status,
        nextNodeId: result.nextNodeId,
        resumeAt: result.resumeAt,
        reason: result.reason,
      };
    }

    currentId = result.nextNodeId;
  }

  return {
    effects,
    visited,
    status: "COMPLETED",
    nextNodeId: null,
    resumeAt: null,
  };
}
