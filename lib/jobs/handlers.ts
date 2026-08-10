import "server-only";
import { db } from "@/lib/db";
import { advanceAutomationRun } from "@/lib/automation/run";
import { sendMessage, type SendRequest } from "@/lib/messaging/send";
import { registerHandler } from "./worker";

/**
 * Job type registry.
 *
 * Imported for side effects by the cron route and by the dev tools, so every
 * entry point ends up with the same handler set — a job whose handler is not
 * registered fails loudly rather than sitting in the table forever.
 */

let registered = false;

export function registerJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerHandler("automation.advance", async (payload) => {
    const runId = String(payload.runId ?? "");
    if (!runId) throw new Error("automation.advance is missing runId");
    await advanceAutomationRun(runId);
  });

  registerHandler("message.send", async (payload) => {
    await sendMessage(payload as unknown as SendRequest);
  });

  registerHandler("campaign.send", async (payload) => {
    const campaignId = String(payload.campaignId ?? "");
    if (!campaignId) throw new Error("campaign.send is missing campaignId");
    await sendCampaign(campaignId);
  });

  registerHandler("webhook.deliver", async (payload) => {
    const url = String(payload.url ?? "");
    if (!url) throw new Error("webhook.deliver is missing url");

    const response = await fetch(url, {
      method: String(payload.method ?? "POST"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: payload.workspaceId,
        contactId: payload.contactId,
        sentAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Throwing hands the retry/backoff decision back to the queue.
      throw new Error(`Webhook returned ${response.status}`);
    }
  });
}

/**
 * Fan a campaign out into one queued send per recipient.
 *
 * Deliberately not sent inline: a 10,000-contact broadcast must not live or die
 * with a single job, and per-recipient jobs give each its own retry.
 */
async function sendCampaign(campaignId: string): Promise<void> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { segment: true },
  });
  if (!campaign) return;
  if (campaign.status !== "SCHEDULED" && campaign.status !== "SENDING") return;

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
  });

  const { compileSegmentForWorkspace } = await import(
    "@/lib/segments/compile"
  );
  const { parseSegmentDefinition } = await import("@/lib/segments/compile");

  const predicate = campaign.segment
    ? parseSegmentDefinition(campaign.segment.definition)
    : null;

  const recipients = await db.contact.findMany({
    where: compileSegmentForWorkspace(campaign.workspaceId, predicate),
    select: { id: true },
  });

  const { enqueue } = await import("./queue");

  for (const recipient of recipients) {
    await enqueue(
      "message.send",
      {
        workspaceId: campaign.workspaceId,
        contactId: recipient.id,
        channel: campaign.channel,
        subject: campaign.subject ?? campaign.name,
        body: campaign.body,
        campaignId: campaign.id,
      },
      {
        workspaceId: campaign.workspaceId,
        // One send per contact per campaign, even if the fan-out is retried.
        idempotencyKey: `campaign:${campaign.id}:contact:${recipient.id}`,
      },
    );
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "SENT", sentAt: new Date() },
  });
}
