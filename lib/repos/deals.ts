import "server-only";
import { db } from "@/lib/db";
import type { DealStatus } from "@/generated/prisma/enums";
import type { TenantContext } from "@/lib/tenant";

/** Sparse gap between kanban cards so a reorder rewrites one row, not a column. */
export const POSITION_GAP = 1000;

export async function getDefaultPipeline(ctx: TenantContext) {
  const pipeline = await db.pipeline.findFirst({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { position: "asc" } } },
  });
  return pipeline;
}

export async function getBoard(ctx: TenantContext, pipelineId?: string) {
  const pipeline = pipelineId
    ? await db.pipeline.findFirst({
        where: { id: pipelineId, workspaceId: ctx.workspaceId },
        include: { stages: { orderBy: { position: "asc" } } },
      })
    : await getDefaultPipeline(ctx);

  if (!pipeline) return null;

  const deals = await db.deal.findMany({
    where: { workspaceId: ctx.workspaceId, pipelineId: pipeline.id },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  const columns = pipeline.stages.map((stage) => {
    const stageDeals = deals.filter((deal) => deal.stageId === stage.id);
    return {
      stage,
      deals: stageDeals,
      total: stageDeals.reduce((sum, deal) => sum + Number(deal.value), 0),
    };
  });

  return { pipeline, columns };
}

export async function createDeal(
  ctx: TenantContext,
  input: {
    title: string;
    stageId: string;
    value?: number;
    contactId?: string | null;
    ownerUserId?: string | null;
    expectedCloseAt?: Date | null;
  },
) {
  const stage = await db.stage.findFirst({
    where: { id: input.stageId, pipeline: { workspaceId: ctx.workspaceId } },
    include: { pipeline: { select: { id: true } } },
  });
  if (!stage) return null;

  if (input.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: input.contactId, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!contact) return null;
  }

  const last = await db.deal.findFirst({
    where: { workspaceId: ctx.workspaceId, stageId: stage.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const deal = await db.deal.create({
    data: {
      workspaceId: ctx.workspaceId,
      pipelineId: stage.pipeline.id,
      stageId: stage.id,
      title: input.title,
      value: input.value ?? 0,
      contactId: input.contactId ?? null,
      ownerUserId: input.ownerUserId ?? ctx.userId,
      expectedCloseAt: input.expectedCloseAt ?? null,
      position: (last?.position ?? 0) + POSITION_GAP,
    },
  });

  if (deal.contactId) {
    await db.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        contactId: deal.contactId,
        type: "DEAL_CREATED",
        title: `Deal created: ${deal.title}`,
        actorUserId: ctx.userId,
      },
    });
  }

  return deal;
}

/**
 * Move a card. `beforeDealId`/`afterDealId` are the neighbours it was dropped
 * between; the new position is their midpoint, so only this row is written.
 */
export async function moveDeal(
  ctx: TenantContext,
  dealId: string,
  toStageId: string,
  neighbours: { beforeDealId?: string | null; afterDealId?: string | null } = {},
) {
  const [deal, stage] = await Promise.all([
    db.deal.findFirst({
      where: { id: dealId, workspaceId: ctx.workspaceId },
      include: { stage: { select: { id: true, name: true } } },
    }),
    db.stage.findFirst({
      where: { id: toStageId, pipeline: { workspaceId: ctx.workspaceId } },
    }),
  ]);
  if (!deal || !stage) return null;

  const [before, after] = await Promise.all([
    neighbours.beforeDealId
      ? db.deal.findFirst({
          where: { id: neighbours.beforeDealId, workspaceId: ctx.workspaceId },
          select: { position: true },
        })
      : null,
    neighbours.afterDealId
      ? db.deal.findFirst({
          where: { id: neighbours.afterDealId, workspaceId: ctx.workspaceId },
          select: { position: true },
        })
      : null,
  ]);

  let position: number;
  if (before && after) {
    position = Math.round((before.position + after.position) / 2);
    // Gap exhausted — fall back to renumbering the destination column.
    if (position === before.position || position === after.position) {
      await renumberStage(ctx, toStageId);
      const refreshed = await db.deal.findFirst({
        where: { id: neighbours.afterDealId!, workspaceId: ctx.workspaceId },
        select: { position: true },
      });
      position = (refreshed?.position ?? POSITION_GAP) - POSITION_GAP / 2;
    }
  } else if (after) {
    position = after.position - POSITION_GAP;
  } else if (before) {
    position = before.position + POSITION_GAP;
  } else {
    position = POSITION_GAP;
  }

  const status: DealStatus = stage.isWon
    ? "WON"
    : stage.isLost
      ? "LOST"
      : "OPEN";

  const updated = await db.deal.update({
    where: { id: dealId },
    data: {
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      position,
      status,
      closedAt: status === "OPEN" ? null : new Date(),
    },
  });

  if (deal.stageId !== stage.id && updated.contactId) {
    await db.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        contactId: updated.contactId,
        type: "DEAL_STAGE_CHANGED",
        title: `${updated.title}: ${deal.stage.name} → ${stage.name}`,
        actorUserId: ctx.userId,
      },
    });
  }

  return updated;
}

async function renumberStage(ctx: TenantContext, stageId: string) {
  const deals = await db.deal.findMany({
    where: { workspaceId: ctx.workspaceId, stageId },
    orderBy: { position: "asc" },
    select: { id: true },
  });

  await db.$transaction(
    deals.map((deal, index) =>
      db.deal.update({
        where: { id: deal.id },
        data: { position: (index + 1) * POSITION_GAP },
      }),
    ),
  );
}

export async function updateDeal(
  ctx: TenantContext,
  dealId: string,
  input: {
    title?: string;
    value?: number;
    expectedCloseAt?: Date | null;
    contactId?: string | null;
    ownerUserId?: string | null;
  },
) {
  const result = await db.deal.updateMany({
    where: { id: dealId, workspaceId: ctx.workspaceId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.expectedCloseAt !== undefined
        ? { expectedCloseAt: input.expectedCloseAt }
        : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.ownerUserId !== undefined
        ? { ownerUserId: input.ownerUserId }
        : {}),
    },
  });
  return result.count > 0;
}

export async function deleteDeal(ctx: TenantContext, dealId: string) {
  return db.deal.deleteMany({
    where: { id: dealId, workspaceId: ctx.workspaceId },
  });
}

export async function ensureDefaultPipeline(workspaceId: string) {
  const existing = await db.pipeline.findFirst({ where: { workspaceId } });
  if (existing) return existing;

  return db.pipeline.create({
    data: {
      workspaceId,
      name: "Sales pipeline",
      isDefault: true,
      stages: {
        create: [
          { name: "New lead", position: 1, probability: 10 },
          { name: "Contacted", position: 2, probability: 25 },
          { name: "Proposal sent", position: 3, probability: 50 },
          { name: "Negotiation", position: 4, probability: 75 },
          { name: "Won", position: 5, probability: 100, isWon: true },
          { name: "Lost", position: 6, probability: 0, isLost: true },
        ],
      },
    },
  });
}
