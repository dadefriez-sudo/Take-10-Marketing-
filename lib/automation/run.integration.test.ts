import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { registerJobHandlers } from "@/lib/jobs/handlers";
import { drainJobs } from "@/lib/jobs/worker";
import { enrollContact, fireTrigger } from "./run";
import type { AutomationGraph } from "./graph";

/**
 * End-to-end proof that the engine actually runs: a contact enters a welcome
 * sequence, gets the first email, parks on a multi-day wait, and — once the
 * clock is pushed forward — takes the correct branch.
 *
 * The unit tests in step.test.ts cover the branching exhaustively; this covers
 * the wiring between the reducer, the queue, and the send pipeline.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const GRAPH: AutomationGraph = {
  entryNodeId: "trigger",
  nodes: [
    {
      id: "trigger",
      kind: "trigger",
      trigger: "contact_created",
      next: "welcome",
    },
    {
      id: "welcome",
      kind: "send_email",
      subject: "Welcome aboard",
      body: "<p>Thanks for reaching out.</p>",
      // Transactional so the test is not at the mercy of quiet hours.
      transactional: true,
      next: "pause",
    },
    { id: "pause", kind: "wait", amount: 3, unit: "days", next: "check" },
    {
      id: "check",
      kind: "condition",
      predicate: {
        combinator: "AND",
        rules: [{ field: "status", operator: "equals", value: "CUSTOMER" }],
      },
      onTrue: "tagCustomer",
      onFalse: "nudge",
    },
    {
      id: "nudge",
      kind: "send_email",
      subject: "Still interested?",
      body: "<p>Here is our booking link.</p>",
      transactional: true,
      next: null,
    },
    { id: "tagCustomer", kind: "add_tag", tagId: "PLACEHOLDER", next: null },
  ],
};

describe.skipIf(!DATABASE_URL)("automation runtime", () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  let workspaceId: string;
  let orgId: string;
  let automationId: string;
  let tagId: string;

  beforeAll(async () => {
    registerJobHandlers();

    const org = await db.organization.create({
      data: { name: `Engine ${suffix}`, slug: `engine-${suffix}` },
    });
    orgId = org.id;

    const workspace = await db.workspace.create({
      data: {
        organizationId: orgId,
        name: "Engine Test",
        slug: `engine-${suffix}`,
        timezone: "America/Chicago",
      },
    });
    workspaceId = workspace.id;

    const tag = await db.tag.create({
      data: { workspaceId, name: `converted-${suffix}` },
    });
    tagId = tag.id;

    const automation = await db.automation.create({
      data: {
        workspaceId,
        name: `Welcome ${suffix}`,
        status: "ACTIVE",
      },
    });
    automationId = automation.id;

    const graph = JSON.parse(JSON.stringify(GRAPH)) as AutomationGraph;
    const tagNode = graph.nodes.find((node) => node.id === "tagCustomer")!;
    (tagNode as { tagId: string }).tagId = tagId;

    const version = await db.automationVersion.create({
      data: {
        automationId,
        version: 1,
        graph: graph as unknown as object,
        publishedAt: new Date(),
      },
    });

    await db.automation.update({
      where: { id: automationId },
      data: { activeVersionId: version.id },
    });
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
  });

  async function makeContact(status: "LEAD" | "CUSTOMER" = "LEAD") {
    return db.contact.create({
      data: {
        workspaceId,
        email: `runner-${Math.random().toString(36).slice(2, 8)}@example.test`,
        firstName: "Runner",
        status,
      },
    });
  }

  it("sends the first email and parks on the wait", async () => {
    const contact = await makeContact();
    const runId = await enrollContact(automationId, contact.id);
    expect(runId).toBeTruthy();

    await drainJobs({ limit: 10 });

    const run = await db.automationRun.findUnique({ where: { id: runId! } });
    expect(run?.status).toBe("WAITING");
    expect(run?.currentNodeId).toBe("check");
    expect(run?.resumeAt).toBeInstanceOf(Date);

    const messages = await db.message.findMany({
      where: { contactId: contact.id },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toBe("Welcome aboard");
    expect(messages[0]!.status).toBe("SENT");

    // The mock transport captured it rather than sending for real.
    const captured = await db.devInbox.findFirst({
      where: { to: contact.email! },
    });
    expect(captured).toBeTruthy();
  });

  it("resumes after the wait and nudges a contact who has not converted", async () => {
    const contact = await makeContact();
    const runId = await enrollContact(automationId, contact.id);
    await drainJobs({ limit: 10 });

    // Time travel: pull the parked job forward instead of waiting three days.
    await db.job.updateMany({
      where: { completedAt: null, failedAt: null },
      data: { runAt: new Date() },
    });
    await drainJobs({ limit: 10 });

    const run = await db.automationRun.findUnique({ where: { id: runId! } });
    expect(run?.status).toBe("COMPLETED");

    const subjects = (
      await db.message.findMany({
        where: { contactId: contact.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((message) => message.subject);

    expect(subjects).toEqual(["Welcome aboard", "Still interested?"]);
  });

  it("takes the other branch for a contact who converted mid-sequence", async () => {
    const contact = await makeContact();
    const runId = await enrollContact(automationId, contact.id);
    await drainJobs({ limit: 10 });

    // The contact becomes a customer while the run is parked.
    await db.contact.update({
      where: { id: contact.id },
      data: { status: "CUSTOMER" },
    });

    await db.job.updateMany({
      where: { completedAt: null, failedAt: null },
      data: { runAt: new Date() },
    });
    await drainJobs({ limit: 10 });

    const run = await db.automationRun.findUnique({ where: { id: runId! } });
    expect(run?.status).toBe("COMPLETED");

    const tagged = await db.contactTag.findFirst({
      where: { contactId: contact.id, tagId },
    });
    expect(tagged).toBeTruthy();

    const subjects = (
      await db.message.findMany({ where: { contactId: contact.id } })
    ).map((message) => message.subject);
    expect(subjects).toEqual(["Welcome aboard"]);
  });

  it("refuses to enroll the same contact twice", async () => {
    const contact = await makeContact();

    const first = await enrollContact(automationId, contact.id);
    const second = await enrollContact(automationId, contact.id);

    expect(first).toBeTruthy();
    // Re-entry is off, so a repeat form submission must not restart the
    // sequence and re-send the welcome email.
    expect(second).toBeNull();
  });

  it("enrolls via a matching trigger and ignores non-matching ones", async () => {
    const contact = await makeContact();

    const wrong = await fireTrigger(workspaceId, "form_submitted", contact.id);
    expect(wrong).toBe(0);

    const right = await fireTrigger(workspaceId, "contact_created", contact.id);
    expect(right).toBe(1);
  });

  it("does not advance runs belonging to a paused automation", async () => {
    const contact = await makeContact();
    const runId = await enrollContact(automationId, contact.id);

    await db.automation.update({
      where: { id: automationId },
      data: { status: "PAUSED" },
    });

    await drainJobs({ limit: 10 });

    const run = await db.automationRun.findUnique({ where: { id: runId! } });
    expect(run?.status).toBe("RUNNING");
    expect(
      await db.message.count({ where: { contactId: contact.id } }),
    ).toBe(0);

    await db.automation.update({
      where: { id: automationId },
      data: { status: "ACTIVE" },
    });
  });

  it("suppresses a send to an unsubscribed address rather than delivering it", async () => {
    const contact = await db.contact.create({
      data: {
        workspaceId,
        email: `blocked-${suffix}@example.test`,
        firstName: "Blocked",
        status: "LEAD",
      },
    });

    await db.suppression.create({
      data: {
        workspaceId,
        channel: "EMAIL",
        address: contact.email!.toLowerCase(),
        reason: "UNSUBSCRIBE",
      },
    });

    await enrollContact(automationId, contact.id);
    await drainJobs({ limit: 10 });

    const message = await db.message.findFirst({
      where: { contactId: contact.id },
    });

    expect(message?.status).toBe("SUPPRESSED");
    expect(message?.suppressedReason).toMatch(/suppression list/);

    const delivered = await db.devInbox.findFirst({
      where: { to: contact.email! },
    });
    expect(delivered).toBeNull();
  });
});
