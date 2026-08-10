import type { SegmentGroup } from "@/lib/segments/types";

/**
 * The automation graph: what the builder saves and the runtime executes.
 *
 * Graphs are versioned and immutable once published. A run in flight keeps
 * executing the version it entered on, so editing an automation can never
 * strand a contact halfway through a sequence that no longer exists.
 */

export type NodeKind =
  | "trigger"
  | "send_email"
  | "send_sms"
  | "add_tag"
  | "remove_tag"
  | "update_field"
  | "create_task"
  | "notify_team"
  | "webhook"
  | "wait"
  | "condition"
  | "split"
  | "goal"
  | "exit";

export type TriggerKind =
  | "manual"
  | "tag_added"
  | "tag_removed"
  | "list_joined"
  | "form_submitted"
  | "contact_created"
  | "deal_stage_changed"
  | "date_reached"
  | "webhook"
  // Emitted by later phases; declared now so graphs authored today stay valid.
  | "appointment_booked"
  | "appointment_completed"
  | "appointment_no_show"
  | "appointment_cancelled"
  | "call_missed"
  | "review_received";

export type WaitUnit = "minutes" | "hours" | "days";

export interface BaseNode {
  id: string;
  kind: NodeKind;
  /** Node to run next. `null` ends the run. */
  next?: string | null;
  label?: string;
}

export interface TriggerNode extends BaseNode {
  kind: "trigger";
  trigger: TriggerKind;
  config?: Record<string, unknown>;
}

export interface SendEmailNode extends BaseNode {
  kind: "send_email";
  templateId?: string | null;
  subject: string;
  body: string;
  transactional?: boolean;
}

export interface SendSmsNode extends BaseNode {
  kind: "send_sms";
  body: string;
  transactional?: boolean;
}

export interface TagNode extends BaseNode {
  kind: "add_tag" | "remove_tag";
  tagId: string;
}

export interface UpdateFieldNode extends BaseNode {
  kind: "update_field";
  field: string;
  value: string | number | boolean | null;
}

export interface CreateTaskNode extends BaseNode {
  kind: "create_task";
  title: string;
  dueInDays?: number;
  assigneeUserId?: string | null;
}

export interface NotifyTeamNode extends BaseNode {
  kind: "notify_team";
  message: string;
}

export interface WebhookNode extends BaseNode {
  kind: "webhook";
  url: string;
  method?: "POST" | "GET";
}

export type WaitNode = BaseNode &
  ({ kind: "wait"; amount: number; unit: WaitUnit; untilHour?: never } | {
    kind: "wait";
    /** Hold until this hour in the contact's local time. */
    untilHour: number;
    amount?: never;
    unit?: never;
  });

export interface ConditionNode extends BaseNode {
  kind: "condition";
  predicate: SegmentGroup;
  onTrue: string | null;
  onFalse: string | null;
}

export interface SplitBranch {
  id: string;
  weight: number;
  next: string | null;
}

export interface SplitNode extends BaseNode {
  kind: "split";
  branches: SplitBranch[];
}

/**
 * A goal short-circuits the rest of the sequence when the contact reaches the
 * desired state — the "they booked, stop nagging them" node.
 */
export interface GoalNode extends BaseNode {
  kind: "goal";
  predicate: SegmentGroup;
  onReached: string | null;
}

export interface ExitNode extends BaseNode {
  kind: "exit";
  reason?: string;
}

export type AutomationNode =
  | TriggerNode
  | SendEmailNode
  | SendSmsNode
  | TagNode
  | UpdateFieldNode
  | CreateTaskNode
  | NotifyTeamNode
  | WebhookNode
  | WaitNode
  | ConditionNode
  | SplitNode
  | GoalNode
  | ExitNode;

export interface AutomationGraph {
  entryNodeId: string;
  nodes: AutomationNode[];
}

export class AutomationGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationGraphError";
  }
}

export function findNode(
  graph: AutomationGraph,
  nodeId: string,
): AutomationNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

export function outgoingIds(node: AutomationNode): Array<string | null> {
  switch (node.kind) {
    case "condition":
      return [node.onTrue, node.onFalse];
    case "split":
      return node.branches.map((branch) => branch.next);
    case "goal":
      return [node.onReached, node.next ?? null];
    case "exit":
      return [];
    default:
      return [node.next ?? null];
  }
}

export interface GraphProblem {
  nodeId?: string;
  message: string;
}

/**
 * Structural validation, run before an automation may be published.
 *
 * A broken graph discovered at runtime means contacts silently stall mid-
 * sequence, which is invisible until someone notices the emails stopped — so
 * it is rejected at publish time instead.
 */
export function validateGraph(graph: AutomationGraph): GraphProblem[] {
  const problems: GraphProblem[] = [];

  if (!graph.nodes || graph.nodes.length === 0) {
    return [{ message: "The automation has no steps yet" }];
  }

  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      problems.push({ nodeId: node.id, message: `Duplicate step id "${node.id}"` });
    }
    seen.add(node.id);
  }

  const triggers = graph.nodes.filter((node) => node.kind === "trigger");
  if (triggers.length === 0) {
    problems.push({ message: "The automation needs a trigger" });
  }
  if (triggers.length > 1) {
    problems.push({ message: "An automation can only have one trigger" });
  }

  if (!seen.has(graph.entryNodeId)) {
    problems.push({
      message: `The entry step "${graph.entryNodeId}" does not exist`,
    });
  }

  for (const node of graph.nodes) {
    for (const target of outgoingIds(node)) {
      if (target !== null && !seen.has(target)) {
        problems.push({
          nodeId: node.id,
          message: `Step "${node.id}" points at "${target}", which does not exist`,
        });
      }
    }

    if (node.kind === "split") {
      const total = node.branches.reduce(
        (sum, branch) => sum + branch.weight,
        0,
      );
      if (node.branches.length < 2) {
        problems.push({
          nodeId: node.id,
          message: "A split needs at least two branches",
        });
      }
      if (total <= 0) {
        problems.push({
          nodeId: node.id,
          message: "Split branch weights must add up to more than zero",
        });
      }
    }

    if (node.kind === "wait") {
      if (node.untilHour !== undefined) {
        if (node.untilHour < 0 || node.untilHour > 23) {
          problems.push({
            nodeId: node.id,
            message: "Wait-until hour must be between 0 and 23",
          });
        }
      } else if (!node.amount || node.amount <= 0) {
        problems.push({
          nodeId: node.id,
          message: "A wait must be longer than zero",
        });
      }
    }
  }

  // Unreachable steps are almost always an editing mistake, and they hide the
  // fact that part of the sequence never runs.
  const reachable = new Set<string>();
  const stack = [graph.entryNodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id) || !seen.has(id)) continue;
    reachable.add(id);
    const node = findNode(graph, id)!;
    for (const target of outgoingIds(node)) {
      if (target) stack.push(target);
    }
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      problems.push({
        nodeId: node.id,
        message: `Step "${node.label ?? node.id}" can never be reached`,
      });
    }
  }

  return problems;
}

export function parseGraph(value: unknown): AutomationGraph {
  if (
    value &&
    typeof value === "object" &&
    "nodes" in value &&
    Array.isArray((value as AutomationGraph).nodes) &&
    typeof (value as AutomationGraph).entryNodeId === "string"
  ) {
    return value as AutomationGraph;
  }
  throw new AutomationGraphError("Automation graph is malformed");
}
