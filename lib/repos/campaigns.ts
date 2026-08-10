import "server-only";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { compileSegmentForWorkspace, parseSegmentDefinition } from "@/lib/segments/compile";

export async function listCampaigns(ctx: TenantContext) {
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { segment: { select: { id: true, name: true } } },
  });

  const counts = await db.message.groupBy({
    by: ["campaignId", "status"],
    where: { workspaceId: ctx.workspaceId, campaignId: { not: null } },
    _count: true,
  });

  const byCampaign = new Map<string, Record<string, number>>();
  for (const row of counts) {
    if (!row.campaignId) continue;
    const bucket = byCampaign.get(row.campaignId) ?? {};
    bucket[row.status] = row._count;
    byCampaign.set(row.campaignId, bucket);
  }

  return campaigns.map((campaign) => ({
    ...campaign,
    stats: byCampaign.get(campaign.id) ?? {},
  }));
}

export async function getCampaign(ctx: TenantContext, campaignId: string) {
  return db.campaign.findFirst({
    where: { id: campaignId, workspaceId: ctx.workspaceId },
    include: { segment: true },
  });
}

/**
 * How many contacts a campaign would reach.
 *
 * Shown before sending because "who exactly is this going to" is the question
 * that prevents the expensive mistakes.
 */
export async function estimateAudience(
  ctx: TenantContext,
  segmentId: string | null,
): Promise<number> {
  if (!segmentId) {
    return db.contact.count({
      where: { workspaceId: ctx.workspaceId, status: { not: "UNSUBSCRIBED" } },
    });
  }

  const segment = await db.segment.findFirst({
    where: { id: segmentId, workspaceId: ctx.workspaceId },
  });
  if (!segment) return 0;

  try {
    const predicate = parseSegmentDefinition(segment.definition);
    return db.contact.count({
      where: compileSegmentForWorkspace(ctx.workspaceId, predicate),
    });
  } catch {
    return 0;
  }
}

export interface CampaignInput {
  name: string;
  subject: string;
  body: string;
  segmentId?: string | null;
  scheduledAt?: Date | null;
}

export async function createCampaign(
  ctx: TenantContext,
  input: CampaignInput,
) {
  return db.campaign.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: input.name,
      channel: "EMAIL",
      subject: input.subject,
      body: input.body,
      segmentId: input.segmentId ?? null,
      scheduledAt: input.scheduledAt ?? null,
      status: "DRAFT",
    },
  });
}

export async function updateCampaign(
  ctx: TenantContext,
  campaignId: string,
  input: Partial<CampaignInput>,
) {
  const existing = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId: ctx.workspaceId },
    select: { id: true, status: true },
  });
  if (!existing) return null;

  // Once a send has begun the audience and copy are fixed — editing mid-flight
  // would mean two different messages under one campaign's reporting.
  if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
    return null;
  }

  return db.campaign.update({
    where: { id: campaignId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
      ...(input.scheduledAt !== undefined
        ? { scheduledAt: input.scheduledAt }
        : {}),
    },
  });
}

export async function deleteCampaign(ctx: TenantContext, campaignId: string) {
  return db.campaign.deleteMany({
    where: {
      id: campaignId,
      workspaceId: ctx.workspaceId,
      status: { in: ["DRAFT", "SCHEDULED", "CANCELLED"] },
    },
  });
}
