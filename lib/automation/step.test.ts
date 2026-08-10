import { describe, expect, it } from "vitest";
import { advanceRun, nextLocalHour, step, type StepContext } from "./step";
import { validateGraph, type AutomationGraph, type AutomationNode } from "./graph";
import { localHour } from "@/lib/messaging/guard";
import type { ContactSnapshot } from "@/lib/segments/evaluate";

const CHICAGO = "America/Chicago";
const NOW = new Date("2026-06-15T15:00:00.000Z"); // 10:00 in Chicago

function contact(overrides: Partial<ContactSnapshot> = {}): ContactSnapshot {
  return {
    email: "ava@acme.com",
    phone: "+15125550100",
    firstName: "Ava",
    lastName: "Alvarez",
    company: "Acme Dental",
    jobTitle: null,
    source: "website-form",
    timezone: CHICAGO,
    status: "LEAD",
    ownerUserId: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: NOW,
    lastActivityAt: NOW,
    tagIds: [],
    listIds: [],
    customFields: {},
    ...overrides,
  };
}

function ctx(overrides: Partial<StepContext> = {}): StepContext {
  return {
    now: NOW,
    contact: contact(),
    timeZone: CHICAGO,
    random: 0.5,
    ...overrides,
  };
}

describe("action steps", () => {
  it("emits a send_email effect and moves on", () => {
    const result = step(
      {
        id: "a",
        kind: "send_email",
        subject: "Hello",
        body: "<p>Hi</p>",
        next: "b",
      },
      ctx(),
    );

    expect(result.effects).toEqual([
      {
        type: "send_email",
        subject: "Hello",
        body: "<p>Hi</p>",
        transactional: false,
      },
    ]);
    expect(result.nextNodeId).toBe("b");
    expect(result.status).toBe("RUNNING");
  });

  it("carries the transactional flag through", () => {
    const result = step(
      { id: "a", kind: "send_sms", body: "Confirmed", transactional: true },
      ctx(),
    );
    expect(result.effects[0]).toMatchObject({ transactional: true });
  });

  it("completes when a step has no next", () => {
    const result = step(
      { id: "a", kind: "add_tag", tagId: "t1", next: null },
      ctx(),
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.nextNodeId).toBeNull();
  });

  it("computes a task due date from the injected clock", () => {
    const result = step(
      { id: "a", kind: "create_task", title: "Call back", dueInDays: 3 },
      ctx(),
    );

    expect(result.effects[0]).toMatchObject({
      type: "create_task",
      title: "Call back",
      dueAt: new Date("2026-06-18T15:00:00.000Z"),
    });
  });

  it("leaves a task without a due date when none is configured", () => {
    const result = step({ id: "a", kind: "create_task", title: "Review" }, ctx());
    expect(result.effects[0]).toMatchObject({ dueAt: null });
  });
});

describe("wait steps", () => {
  it("pauses for a relative duration and points at the following step", () => {
    const result = step(
      { id: "w", kind: "wait", amount: 3, unit: "days", next: "b" },
      ctx(),
    );

    expect(result.status).toBe("WAITING");
    expect(result.nextNodeId).toBe("b");
    expect(result.resumeAt).toEqual(new Date("2026-06-18T15:00:00.000Z"));
  });

  it.each([
    ["minutes", 30, "2026-06-15T15:30:00.000Z"],
    ["hours", 6, "2026-06-15T21:00:00.000Z"],
    ["days", 1, "2026-06-16T15:00:00.000Z"],
  ] as const)("handles %s", (unit, amount, expected) => {
    const result = step(
      { id: "w", kind: "wait", amount, unit, next: "b" },
      ctx(),
    );
    expect(result.resumeAt).toEqual(new Date(expected));
  });

  it("waits until a local hour, in the contact's zone", () => {
    // It is 10:00 in Chicago; waiting until 09:00 must land tomorrow.
    const result = step(
      { id: "w", kind: "wait", untilHour: 9, next: "b" },
      ctx(),
    );

    expect(result.status).toBe("WAITING");
    expect(localHour(result.resumeAt!, CHICAGO)).toBe(9);
    expect(result.resumeAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("waits until later the same day when the hour is still ahead", () => {
    const result = step(
      { id: "w", kind: "wait", untilHour: 14, next: "b" },
      ctx(),
    );
    expect(localHour(result.resumeAt!, CHICAGO)).toBe(14);
    expect(result.resumeAt!.getTime() - NOW.getTime()).toBeLessThan(
      5 * 3_600_000,
    );
  });

  it("does not schedule a resume when the wait is the last step", () => {
    const result = step(
      { id: "w", kind: "wait", amount: 1, unit: "days", next: null },
      ctx(),
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.resumeAt).toBeNull();
  });

  it("keeps the local hour stable across a DST boundary", () => {
    // 2026-03-07 10:00 Chicago, waiting until 09:00 — the next morning is the
    // spring-forward day, and the answer must still be 9am local.
    const beforeDst = new Date("2026-03-07T16:00:00.000Z");
    const resume = nextLocalHour(beforeDst, CHICAGO, 9);
    expect(localHour(resume, CHICAGO)).toBe(9);
  });
});

describe("condition steps", () => {
  const node: AutomationNode = {
    id: "c",
    kind: "condition",
    predicate: {
      combinator: "AND",
      rules: [{ field: "status", operator: "equals", value: "CUSTOMER" }],
    },
    onTrue: "yes",
    onFalse: "no",
  };

  it("takes the true branch when the contact matches", () => {
    const result = step(node, ctx({ contact: contact({ status: "CUSTOMER" }) }));
    expect(result.nextNodeId).toBe("yes");
  });

  it("takes the false branch otherwise", () => {
    const result = step(node, ctx({ contact: contact({ status: "LEAD" }) }));
    expect(result.nextNodeId).toBe("no");
  });

  it("completes when the chosen branch is empty", () => {
    const result = step(
      { ...node, onFalse: null } as AutomationNode,
      ctx({ contact: contact({ status: "LEAD" }) }),
    );
    expect(result.status).toBe("COMPLETED");
  });
});

describe("split steps", () => {
  const node: AutomationNode = {
    id: "s",
    kind: "split",
    branches: [
      { id: "a", weight: 50, next: "arm-a" },
      { id: "b", weight: 50, next: "arm-b" },
    ],
  };

  it("picks the first arm for a low roll and the second for a high one", () => {
    expect(step(node, ctx({ random: 0.1 })).nextNodeId).toBe("arm-a");
    expect(step(node, ctx({ random: 0.9 })).nextNodeId).toBe("arm-b");
  });

  it("records which arm was taken", () => {
    expect(step(node, ctx({ random: 0.1 })).effects).toEqual([
      { type: "record_split", nodeId: "s", branchId: "a" },
    ]);
  });

  it("respects uneven weights", () => {
    const weighted: AutomationNode = {
      id: "s",
      kind: "split",
      branches: [
        { id: "a", weight: 90, next: "arm-a" },
        { id: "b", weight: 10, next: "arm-b" },
      ],
    };

    expect(step(weighted, ctx({ random: 0.85 })).nextNodeId).toBe("arm-a");
    expect(step(weighted, ctx({ random: 0.95 })).nextNodeId).toBe("arm-b");
  });

  it("never falls off the end at random = 1", () => {
    // Math.random() never returns 1, but a caller could pass it; stranding the
    // run would be silent data loss.
    const result = step(node, ctx({ random: 1 }));
    expect(result.nextNodeId).toBe("arm-b");
    expect(result.status).toBe("RUNNING");
  });

  it("fails loudly when every weight is zero", () => {
    const broken: AutomationNode = {
      id: "s",
      kind: "split",
      branches: [
        { id: "a", weight: 0, next: "arm-a" },
        { id: "b", weight: 0, next: "arm-b" },
      ],
    };
    const result = step(broken, ctx());
    expect(result.status).toBe("FAILED");
    expect(result.reason).toMatch(/positive branch weights/);
  });
});

describe("goal steps", () => {
  const node: AutomationNode = {
    id: "g",
    kind: "goal",
    predicate: {
      combinator: "AND",
      rules: [{ field: "status", operator: "equals", value: "CUSTOMER" }],
    },
    onReached: "done",
    next: "keep-going",
  };

  it("jumps when the goal is met", () => {
    const result = step(node, ctx({ contact: contact({ status: "CUSTOMER" }) }));
    expect(result.nextNodeId).toBe("done");
    expect(result.effects).toEqual([{ type: "goal_reached", nodeId: "g" }]);
  });

  it("continues the sequence when it is not", () => {
    const result = step(node, ctx());
    expect(result.nextNodeId).toBe("keep-going");
    expect(result.effects).toEqual([]);
  });
});

describe("exit steps", () => {
  it("stops the run with a reason", () => {
    const result = step(
      { id: "x", kind: "exit", reason: "Unsubscribed" },
      ctx(),
    );
    expect(result.status).toBe("EXITED");
    expect(result.reason).toBe("Unsubscribed");
    expect(result.nextNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const WELCOME: AutomationGraph = {
  entryNodeId: "trigger",
  nodes: [
    { id: "trigger", kind: "trigger", trigger: "form_submitted", next: "email1" },
    {
      id: "email1",
      kind: "send_email",
      subject: "Thanks for getting in touch",
      body: "<p>We'll be right with you.</p>",
      next: "wait1",
    },
    { id: "wait1", kind: "wait", amount: 2, unit: "days", next: "goal1" },
    {
      id: "goal1",
      kind: "goal",
      predicate: {
        combinator: "AND",
        rules: [{ field: "status", operator: "equals", value: "CUSTOMER" }],
      },
      onReached: "tagWon",
      next: "email2",
    },
    {
      id: "email2",
      kind: "send_email",
      subject: "Still thinking it over?",
      body: "<p>Here's our booking link.</p>",
      next: null,
    },
    { id: "tagWon", kind: "add_tag", tagId: "tag_customer", next: null },
  ],
};

describe("advanceRun", () => {
  it("runs to the first wait and reports where to resume", () => {
    const result = advanceRun(WELCOME, "trigger", ctx());

    expect(result.visited).toEqual(["trigger", "email1", "wait1"]);
    expect(result.status).toBe("WAITING");
    expect(result.nextNodeId).toBe("goal1");
    expect(result.resumeAt).toEqual(new Date("2026-06-17T15:00:00.000Z"));
    expect(result.effects).toEqual([
      {
        type: "send_email",
        subject: "Thanks for getting in touch",
        body: "<p>We'll be right with you.</p>",
        transactional: false,
      },
    ]);
  });

  it("resumes after the wait and takes the goal branch when it is met", () => {
    const resumed = advanceRun(
      WELCOME,
      "goal1",
      ctx({ contact: contact({ status: "CUSTOMER" }) }),
    );

    expect(resumed.visited).toEqual(["goal1", "tagWon"]);
    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.effects).toEqual([
      { type: "goal_reached", nodeId: "goal1" },
      { type: "add_tag", tagId: "tag_customer" },
    ]);
  });

  it("resumes and sends the follow-up when the goal is not met", () => {
    const resumed = advanceRun(WELCOME, "goal1", ctx());

    expect(resumed.visited).toEqual(["goal1", "email2"]);
    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.effects).toEqual([
      {
        type: "send_email",
        subject: "Still thinking it over?",
        body: "<p>Here's our booking link.</p>",
        transactional: false,
      },
    ]);
  });

  it("fails on a dangling reference rather than stalling silently", () => {
    const broken: AutomationGraph = {
      entryNodeId: "a",
      nodes: [{ id: "a", kind: "add_tag", tagId: "t", next: "ghost" }],
    };

    const result = advanceRun(broken, "a", ctx());
    expect(result.status).toBe("FAILED");
    expect(result.reason).toMatch(/missing from the graph/);
  });

  it("breaks a loop that never pauses", () => {
    // Without the guard this spins forever inside one job and takes the worker
    // with it.
    const loop: AutomationGraph = {
      entryNodeId: "a",
      nodes: [
        { id: "a", kind: "add_tag", tagId: "t", next: "b" },
        { id: "b", kind: "add_tag", tagId: "u", next: "a" },
      ],
    };

    const result = advanceRun(loop, "a", ctx(), 10);
    expect(result.status).toBe("FAILED");
    expect(result.reason).toMatch(/without pausing/);
    expect(result.visited.length).toBe(10);
  });

  it("stops at an exit without running later steps", () => {
    const graph: AutomationGraph = {
      entryNodeId: "a",
      nodes: [
        { id: "a", kind: "exit", reason: "Opted out" },
        { id: "b", kind: "add_tag", tagId: "never", next: null },
      ],
    };

    const result = advanceRun(graph, "a", ctx());
    expect(result.status).toBe("EXITED");
    expect(result.effects).toEqual([]);
  });
});

describe("validateGraph", () => {
  it("accepts the welcome sequence", () => {
    expect(validateGraph(WELCOME)).toEqual([]);
  });

  it("rejects an empty automation", () => {
    expect(
      validateGraph({ entryNodeId: "a", nodes: [] }),
    ).toEqual([{ message: "The automation has no steps yet" }]);
  });

  it("catches a dangling reference", () => {
    const problems = validateGraph({
      entryNodeId: "t",
      nodes: [
        { id: "t", kind: "trigger", trigger: "manual", next: "ghost" },
      ],
    });
    expect(problems.map((p) => p.message).join(" ")).toMatch(/does not exist/);
  });

  it("catches an unreachable step", () => {
    const problems = validateGraph({
      entryNodeId: "t",
      nodes: [
        { id: "t", kind: "trigger", trigger: "manual", next: null },
        { id: "orphan", kind: "add_tag", tagId: "x", next: null },
      ],
    });
    expect(problems.map((p) => p.message).join(" ")).toMatch(
      /can never be reached/,
    );
  });

  it("requires exactly one trigger", () => {
    const none = validateGraph({
      entryNodeId: "a",
      nodes: [{ id: "a", kind: "add_tag", tagId: "x", next: null }],
    });
    expect(none.map((p) => p.message).join(" ")).toMatch(/needs a trigger/);

    const two = validateGraph({
      entryNodeId: "t1",
      nodes: [
        { id: "t1", kind: "trigger", trigger: "manual", next: "t2" },
        { id: "t2", kind: "trigger", trigger: "manual", next: null },
      ],
    });
    expect(two.map((p) => p.message).join(" ")).toMatch(/only have one trigger/);
  });

  it("rejects a zero-length wait and an out-of-range hour", () => {
    const problems = validateGraph({
      entryNodeId: "t",
      nodes: [
        { id: "t", kind: "trigger", trigger: "manual", next: "w" },
        { id: "w", kind: "wait", amount: 0, unit: "days", next: "h" },
        { id: "h", kind: "wait", untilHour: 27, next: null },
      ],
    });

    const text = problems.map((p) => p.message).join(" ");
    expect(text).toMatch(/longer than zero/);
    expect(text).toMatch(/between 0 and 23/);
  });

  it("rejects a split with one branch or no weight", () => {
    const problems = validateGraph({
      entryNodeId: "t",
      nodes: [
        { id: "t", kind: "trigger", trigger: "manual", next: "s" },
        {
          id: "s",
          kind: "split",
          branches: [{ id: "only", weight: 0, next: null }],
        },
      ],
    });

    const text = problems.map((p) => p.message).join(" ");
    expect(text).toMatch(/at least two branches/);
    expect(text).toMatch(/add up to more than zero/);
  });
});
