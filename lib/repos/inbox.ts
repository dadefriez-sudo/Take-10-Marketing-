import "server-only";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";

/**
 * The unified inbox.
 *
 * Today it carries SMS and email; Phase 5 fills it with missed-call text-back
 * replies, which is when it becomes the screen the agency actually lives in.
 */

export async function listConversations(
  ctx: TenantContext,
  filter: { status?: "OPEN" | "CLOSED" } = {},
) {
  return db.conversation.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, direction: true, createdAt: true },
      },
    },
  });
}

export async function getConversation(
  ctx: TenantContext,
  conversationId: string,
) {
  return db.conversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspaceId },
    include: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
        },
      },
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
}

export async function markRead(ctx: TenantContext, conversationId: string) {
  const result = await db.conversation.updateMany({
    where: { id: conversationId, workspaceId: ctx.workspaceId },
    data: { unreadCount: 0 },
  });
  return result.count > 0;
}

export async function setConversationStatus(
  ctx: TenantContext,
  conversationId: string,
  status: "OPEN" | "CLOSED",
) {
  const result = await db.conversation.updateMany({
    where: { id: conversationId, workspaceId: ctx.workspaceId },
    data: { status },
  });
  return result.count > 0;
}

export async function unreadTotal(ctx: TenantContext) {
  const result = await db.conversation.aggregate({
    where: { workspaceId: ctx.workspaceId, status: "OPEN" },
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount ?? 0;
}
