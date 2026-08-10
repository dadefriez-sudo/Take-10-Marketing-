"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, writeAuditLog } from "@/lib/tenant";
import {
  createCampaign,
  deleteCampaign,
  estimateAudience,
  updateCampaign,
} from "@/lib/repos/campaigns";
import { enqueue } from "@/lib/jobs/queue";

export interface CampaignState {
  error?: string;
  success?: string;
}

const schema = z.object({
  name: z.string().trim().min(1, "Name the campaign").max(160),
  subject: z.string().trim().min(1, "Write a subject line").max(200),
  body: z.string().trim().min(1, "Write the message").max(50_000),
  segmentId: z.string().optional(),
});

export async function createCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "segment:write");

  const parsed = schema.safeParse({
    name: formData.get("name"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    segmentId: String(formData.get("segmentId") ?? "") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  try {
    await createCampaign(ctx, {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      segmentId: parsed.data.segmentId ?? null,
    });
  } catch {
    return { error: "A campaign with that name already exists" };
  }

  revalidatePath(`/w/${workspace}/campaigns`);
  return { success: "Draft created" };
}

export async function updateCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const workspace = String(formData.get("workspace") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const ctx = await requirePermission(workspace, "segment:write");

  const parsed = schema.safeParse({
    name: formData.get("name"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    segmentId: String(formData.get("segmentId") ?? "") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  const updated = await updateCampaign(ctx, campaignId, {
    name: parsed.data.name,
    subject: parsed.data.subject,
    body: parsed.data.body,
    segmentId: parsed.data.segmentId ?? null,
  });

  if (!updated) {
    return { error: "This campaign has already started sending" };
  }

  revalidatePath(`/w/${workspace}/campaigns`);
  return { success: "Saved" };
}

/**
 * Hand the campaign to the queue.
 *
 * The fan-out job creates one send per recipient with an idempotency key, so a
 * retried dispatch cannot mail the same person twice.
 */
export async function sendCampaignAction(
  workspace: string,
  campaignId: string,
): Promise<CampaignState> {
  const ctx = await requirePermission(workspace, "segment:write");

  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId: ctx.workspaceId },
    select: { id: true, status: true, segmentId: true },
  });
  if (!campaign) return { error: "That campaign no longer exists" };

  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    return { error: "This campaign has already been sent" };
  }

  const audience = await estimateAudience(ctx, campaign.segmentId);
  if (audience === 0) {
    // Sending to nobody is nearly always a mis-set segment, not an intention.
    return { error: "That audience is empty — check the segment" };
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "SCHEDULED" },
  });

  await enqueue(
    "campaign.send",
    { campaignId },
    {
      workspaceId: ctx.workspaceId,
      idempotencyKey: `campaign-dispatch:${campaignId}`,
    },
  );

  await writeAuditLog(ctx, "campaign.sent", {
    targetType: "Campaign",
    targetId: campaignId,
    metadata: { audience },
  });

  revalidatePath(`/w/${workspace}/campaigns`);
  return {
    success: `Queued for ${audience.toLocaleString()} ${
      audience === 1 ? "person" : "people"
    }`,
  };
}

export async function deleteCampaignAction(
  workspace: string,
  campaignId: string,
): Promise<CampaignState> {
  const ctx = await requirePermission(workspace, "segment:write");
  const result = await deleteCampaign(ctx, campaignId);

  if (result.count === 0) {
    return { error: "Only drafts can be deleted" };
  }

  revalidatePath(`/w/${workspace}/campaigns`);
  return { success: "Deleted" };
}

export async function audienceSizeAction(
  workspace: string,
  segmentId: string | null,
): Promise<number> {
  const ctx = await requirePermission(workspace, "contact:read");
  return estimateAudience(ctx, segmentId);
}
