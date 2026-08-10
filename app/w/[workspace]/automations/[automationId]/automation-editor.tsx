"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, Trash2 } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import type {
  AutomationGraph,
  AutomationNode,
  NodeKind,
} from "@/lib/automation/graph";
import { validateGraph } from "@/lib/automation/graph";
import {
  enrollContactAction,
  publishAction,
  saveGraphAction,
  setStatusAction,
} from "../actions";

/**
 * A step-list editor rather than a free-form canvas.
 *
 * Steps run top to bottom and are wired automatically; condition and split
 * steps get explicit target pickers, so branching is fully expressible without
 * the cost and fragility of a drag-and-drop graph surface. A visual canvas can
 * replace this later without changing the stored format — the graph shape is
 * already node-and-edge.
 */

const ADDABLE: Array<{ kind: NodeKind; label: string }> = [
  { kind: "send_email", label: "Send email" },
  { kind: "send_sms", label: "Send SMS" },
  { kind: "wait", label: "Wait" },
  { kind: "condition", label: "If / else" },
  { kind: "split", label: "A/B split" },
  { kind: "add_tag", label: "Add tag" },
  { kind: "remove_tag", label: "Remove tag" },
  { kind: "create_task", label: "Create task" },
  { kind: "notify_team", label: "Notify the team" },
  { kind: "goal", label: "Goal" },
  { kind: "exit", label: "Exit" },
];

const TRIGGERS = [
  ["tag_added", "A tag is added"],
  ["tag_removed", "A tag is removed"],
  ["list_joined", "Added to a list"],
  ["form_submitted", "A form is submitted"],
  ["contact_created", "A contact is created"],
  ["deal_stage_changed", "A deal changes stage"],
  ["manual", "Added by hand"],
] as const;

let counter = 0;
function newId(kind: string) {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}-${counter}`;
}

function blankNode(kind: NodeKind, tagId: string): AutomationNode {
  const id = newId(kind);
  switch (kind) {
    case "send_email":
      return {
        id,
        kind,
        subject: "Subject line",
        body: "<p>Write your message…</p>",
        next: null,
      };
    case "send_sms":
      return { id, kind, body: "Your message", next: null };
    case "wait":
      return { id, kind, amount: 1, unit: "days", next: null };
    case "condition":
      return {
        id,
        kind,
        predicate: {
          combinator: "AND",
          rules: [{ field: "status", operator: "equals", value: "CUSTOMER" }],
        },
        onTrue: null,
        onFalse: null,
      };
    case "split":
      return {
        id,
        kind,
        branches: [
          { id: "a", weight: 50, next: null },
          { id: "b", weight: 50, next: null },
        ],
      };
    case "add_tag":
    case "remove_tag":
      return { id, kind, tagId, next: null };
    case "create_task":
      return { id, kind, title: "Follow up", dueInDays: 1, next: null };
    case "notify_team":
      return { id, kind, message: "Check on this contact", next: null };
    case "goal":
      return {
        id,
        kind,
        predicate: {
          combinator: "AND",
          rules: [{ field: "status", operator: "equals", value: "CUSTOMER" }],
        },
        onReached: null,
        next: null,
      };
    case "exit":
      return { id, kind, reason: "Left the sequence" };
    default:
      return { id, kind: "exit" } as AutomationNode;
  }
}

/** Wire every non-branching step to the one below it. */
function relink(nodes: AutomationNode[]): AutomationNode[] {
  return nodes.map((node, index) => {
    const following = nodes[index + 1]?.id ?? null;
    if (node.kind === "condition" || node.kind === "split") return node;
    if (node.kind === "exit") return node;
    if (node.kind === "goal") return { ...node, next: following };
    return { ...node, next: following } as AutomationNode;
  });
}

export function AutomationEditor({
  workspace,
  automationId,
  status,
  initialGraph,
  tags,
  contacts,
}: {
  workspace: string;
  automationId: string;
  status: string;
  initialGraph: AutomationGraph;
  tags: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; name: string }>;
}) {
  const [nodes, setNodes] = useState<AutomationNode[]>(initialGraph.nodes);
  const [pending, startTransition] = useTransition();
  const [testContact, setTestContact] = useState("");
  const router = useRouter();

  const graph: AutomationGraph = {
    entryNodeId: nodes[0]?.id ?? "trigger",
    nodes,
  };
  const problems = validateGraph(graph);

  function update(id: string, patch: Partial<AutomationNode>) {
    setNodes((current) =>
      current.map((node) =>
        node.id === id ? ({ ...node, ...patch } as AutomationNode) : node,
      ),
    );
  }

  function addStep(kind: NodeKind) {
    setNodes((current) =>
      relink([...current, blankNode(kind, tags[0]?.id ?? "")]),
    );
  }

  function removeStep(id: string) {
    setNodes((current) => relink(current.filter((node) => node.id !== id)));
  }

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  const stepOptions = nodes
    .filter((node) => node.kind !== "trigger")
    .map((node) => ({ id: node.id, label: node.label ?? node.kind }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Steps</CardTitle>
            <CardDescription>
              Steps run top to bottom. Branching steps choose their own targets.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(() => saveGraphAction(workspace, automationId, graph))
              }
            >
              Save draft
            </Button>
            <Button
              disabled={pending || problems.length > 0}
              onClick={() =>
                run(async () => {
                  const saved = await saveGraphAction(
                    workspace,
                    automationId,
                    graph,
                  );
                  if (saved.error) return saved;
                  return publishAction(workspace, automationId);
                })
              }
            >
              {status === "ACTIVE" ? "Publish changes" : "Publish & activate"}
            </Button>
            {status === "ACTIVE" ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(() => setStatusAction(workspace, automationId, "PAUSED"))
                }
              >
                Pause
              </Button>
            ) : null}
            {status === "PAUSED" ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(() => setStatusAction(workspace, automationId, "ACTIVE"))
                }
              >
                Resume
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {problems.length > 0 ? (
            <div className="border-destructive/40 bg-destructive/10 rounded-md border p-3">
              <p className="text-destructive text-sm font-medium">
                Fix before publishing
              </p>
              <ul className="text-destructive mt-1 list-inside list-disc text-sm">
                {problems.map((problem, index) => (
                  <li key={index}>{problem.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {nodes.map((node, index) => (
            <div key={node.id}>
              <StepCard
                node={node}
                index={index}
                tags={tags}
                stepOptions={stepOptions}
                onChange={(patch) => update(node.id, patch)}
                onRemove={
                  node.kind === "trigger" ? undefined : () => removeStep(node.id)
                }
              />
              {index < nodes.length - 1 ? (
                <div className="flex justify-center py-1">
                  <ArrowDown className="text-muted-foreground size-4" />
                </div>
              ) : null}
            </div>
          ))}

          <div className="flex flex-wrap gap-2 pt-2">
            {ADDABLE.map((option) => (
              <Button
                key={option.kind}
                size="sm"
                variant="secondary"
                onClick={() => addStep(option.kind)}
              >
                + {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test with a contact</CardTitle>
          <CardDescription>
            Enrols one person so you can watch the sequence run. In development,
            POST /api/dev/tick to jump past the waits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Select
              className="max-w-xs"
              value={testContact}
              onChange={(event) => setTestContact(event.target.value)}
            >
              <option value="">Choose a contact…</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={pending || !testContact}
              onClick={() =>
                run(() =>
                  enrollContactAction(workspace, automationId, testContact),
                )
              }
            >
              Enrol
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepCard({
  node,
  index,
  tags,
  stepOptions,
  onChange,
  onRemove,
}: {
  node: AutomationNode;
  index: number;
  tags: Array<{ id: string; name: string }>;
  stepOptions: Array<{ id: string; label: string }>;
  onChange: (patch: Partial<AutomationNode>) => void;
  onRemove?: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{index + 1}</Badge>
          <span className="text-sm font-medium">{labelFor(node)}</span>
        </div>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {node.kind === "trigger" ? (
          <Field label="When this happens" className="sm:col-span-2">
            <Select
              value={node.trigger}
              onChange={(event) =>
                onChange({ trigger: event.target.value } as Partial<AutomationNode>)
              }
            >
              {TRIGGERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {node.kind === "send_email" ? (
          <>
            <Field label="Subject" className="sm:col-span-2">
              <Input
                value={node.subject}
                onChange={(event) => onChange({ subject: event.target.value })}
              />
            </Field>
            <Field label="Body (HTML)" className="sm:col-span-2">
              <Textarea
                value={node.body}
                rows={4}
                onChange={(event) => onChange({ body: event.target.value })}
              />
            </Field>
            <TransactionalToggle
              checked={node.transactional ?? false}
              onChange={(transactional) =>
                onChange({ transactional } as Partial<AutomationNode>)
              }
            />
          </>
        ) : null}

        {node.kind === "send_sms" ? (
          <>
            <Field
              label="Message"
              className="sm:col-span-2"
              hint="An opt-out line is appended automatically."
            >
              <Textarea
                value={node.body}
                rows={3}
                onChange={(event) => onChange({ body: event.target.value })}
              />
            </Field>
            <TransactionalToggle
              checked={node.transactional ?? false}
              onChange={(transactional) =>
                onChange({ transactional } as Partial<AutomationNode>)
              }
            />
          </>
        ) : null}

        {node.kind === "wait" && node.untilHour === undefined ? (
          <>
            <Field label="Wait">
              <Input
                type="number"
                min={1}
                value={node.amount ?? 1}
                onChange={(event) =>
                  onChange({
                    amount: Number(event.target.value),
                  } as Partial<AutomationNode>)
                }
              />
            </Field>
            <Field label="Unit">
              <Select
                value={node.unit ?? "days"}
                onChange={(event) =>
                  onChange({
                    unit: event.target.value,
                  } as unknown as Partial<AutomationNode>)
                }
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </Select>
            </Field>
          </>
        ) : null}

        {node.kind === "add_tag" || node.kind === "remove_tag" ? (
          <Field label="Tag" className="sm:col-span-2">
            <Select
              value={node.tagId}
              onChange={(event) => onChange({ tagId: event.target.value })}
            >
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {node.kind === "create_task" ? (
          <>
            <Field label="Task">
              <Input
                value={node.title}
                onChange={(event) => onChange({ title: event.target.value })}
              />
            </Field>
            <Field label="Due in days">
              <Input
                type="number"
                min={0}
                value={node.dueInDays ?? 1}
                onChange={(event) =>
                  onChange({ dueInDays: Number(event.target.value) })
                }
              />
            </Field>
          </>
        ) : null}

        {node.kind === "notify_team" ? (
          <Field label="Message" className="sm:col-span-2">
            <Input
              value={node.message}
              onChange={(event) => onChange({ message: event.target.value })}
            />
          </Field>
        ) : null}

        {node.kind === "condition" ? (
          <>
            <Field label="If contact status is" className="sm:col-span-2">
              <Select
                value={String(node.predicate.rules[0] &&
                  "value" in node.predicate.rules[0]
                    ? node.predicate.rules[0].value
                    : "CUSTOMER")}
                onChange={(event) =>
                  onChange({
                    predicate: {
                      combinator: "AND",
                      rules: [
                        {
                          field: "status",
                          operator: "equals",
                          value: event.target.value,
                        },
                      ],
                    },
                  } as Partial<AutomationNode>)
                }
              >
                <option value="LEAD">Lead</option>
                <option value="ACTIVE">Active</option>
                <option value="CUSTOMER">Customer</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
              </Select>
            </Field>
            <Field label="Then go to">
              <StepSelect
                value={node.onTrue}
                options={stepOptions}
                onChange={(value) =>
                  onChange({ onTrue: value } as Partial<AutomationNode>)
                }
              />
            </Field>
            <Field label="Otherwise go to">
              <StepSelect
                value={node.onFalse}
                options={stepOptions}
                onChange={(value) =>
                  onChange({ onFalse: value } as Partial<AutomationNode>)
                }
              />
            </Field>
          </>
        ) : null}

        {node.kind === "goal" ? (
          <Field label="When reached, go to" className="sm:col-span-2">
            <StepSelect
              value={node.onReached}
              options={stepOptions}
              onChange={(value) =>
                onChange({ onReached: value } as Partial<AutomationNode>)
              }
            />
          </Field>
        ) : null}

        {node.kind === "split" ? (
          <>
            {node.branches.map((branch, branchIndex) => (
              <Field key={branch.id} label={`Arm ${branch.id.toUpperCase()}`}>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={branch.weight}
                    className="w-20"
                    onChange={(event) => {
                      const branches = [...node.branches];
                      branches[branchIndex] = {
                        ...branch,
                        weight: Number(event.target.value),
                      };
                      onChange({ branches } as Partial<AutomationNode>);
                    }}
                  />
                  <StepSelect
                    value={branch.next}
                    options={stepOptions}
                    onChange={(value) => {
                      const branches = [...node.branches];
                      branches[branchIndex] = { ...branch, next: value };
                      onChange({ branches } as Partial<AutomationNode>);
                    }}
                  />
                </div>
              </Field>
            ))}
          </>
        ) : null}

        {node.kind === "exit" ? (
          <Field label="Reason" className="sm:col-span-2">
            <Input
              value={node.reason ?? ""}
              onChange={(event) => onChange({ reason: event.target.value })}
            />
          </Field>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Marks a step as a direct response to something the recipient just did — an
 * appointment confirmation, a password reset. Those bypass quiet hours and
 * marketing consent, but never the suppression list.
 */
function TransactionalToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="sm:col-span-2 flex items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0"
      />
      <span className="text-sm">
        Transactional
        <span className="text-muted-foreground block text-xs">
          Confirms something the contact just did. Sends outside quiet hours and
          without marketing consent — but never to an unsubscribed address.
        </span>
      </span>
    </label>
  );
}

function StepSelect({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string | null) => void;
}) {
  return (
    <Select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">End the automation</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label} ({option.id.slice(0, 12)})
        </option>
      ))}
    </Select>
  );
}

function labelFor(node: AutomationNode): string {
  const found = ADDABLE.find((option) => option.kind === node.kind);
  if (found) return found.label;
  if (node.kind === "trigger") return "Trigger";
  return node.kind;
}
