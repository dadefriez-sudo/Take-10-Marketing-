import "server-only";
import { db } from "@/lib/db";
import type { TaskPriority } from "@/generated/prisma/enums";
import type { SegmentGroup } from "@/lib/segments/types";
import type { TenantContext } from "@/lib/tenant";

// --- tags ------------------------------------------------------------------

export async function listTags(ctx: TenantContext) {
  return db.tag.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true } } },
  });
}

export async function createTag(
  ctx: TenantContext,
  name: string,
  color?: string,
) {
  return db.tag.upsert({
    where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } },
    update: color ? { color } : {},
    create: { workspaceId: ctx.workspaceId, name, color: color ?? "#64748B" },
  });
}

export async function deleteTag(ctx: TenantContext, tagId: string) {
  return db.tag.deleteMany({
    where: { id: tagId, workspaceId: ctx.workspaceId },
  });
}

// --- lists -----------------------------------------------------------------

export async function listLists(ctx: TenantContext) {
  return db.list.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true } } },
  });
}

export async function createList(
  ctx: TenantContext,
  name: string,
  description?: string,
) {
  return db.list.upsert({
    where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } },
    update: { description },
    create: { workspaceId: ctx.workspaceId, name, description },
  });
}

export async function deleteList(ctx: TenantContext, listId: string) {
  return db.list.deleteMany({
    where: { id: listId, workspaceId: ctx.workspaceId },
  });
}

// --- segments --------------------------------------------------------------

export async function listSegments(ctx: TenantContext) {
  return db.segment.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
  });
}

export async function getSegment(ctx: TenantContext, segmentId: string) {
  return db.segment.findFirst({
    where: { id: segmentId, workspaceId: ctx.workspaceId },
  });
}

export async function saveSegment(
  ctx: TenantContext,
  input: {
    id?: string;
    name: string;
    description?: string;
    definition: SegmentGroup;
  },
) {
  if (input.id) {
    const existing = await db.segment.findFirst({
      where: { id: input.id, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!existing) return null;

    return db.segment.update({
      where: { id: input.id },
      data: {
        name: input.name,
        description: input.description,
        definition: input.definition as object,
      },
    });
  }

  return db.segment.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description,
      definition: input.definition as object,
    },
  });
}

export async function deleteSegment(ctx: TenantContext, segmentId: string) {
  return db.segment.deleteMany({
    where: { id: segmentId, workspaceId: ctx.workspaceId },
  });
}

// --- custom fields ---------------------------------------------------------

export async function listCustomFields(ctx: TenantContext) {
  return db.customField.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ position: "asc" }, { label: "asc" }],
  });
}

export async function setCustomFieldValue(
  ctx: TenantContext,
  contactId: string,
  fieldId: string,
  value: unknown,
) {
  const [contact, field] = await Promise.all([
    db.contact.findFirst({
      where: { id: contactId, workspaceId: ctx.workspaceId },
      select: { id: true },
    }),
    db.customField.findFirst({
      where: { id: fieldId, workspaceId: ctx.workspaceId },
      select: { id: true },
    }),
  ]);
  if (!contact || !field) return null;

  return db.contactFieldValue.upsert({
    where: { contactId_fieldId: { contactId, fieldId } },
    update: { value: value as object },
    create: { contactId, fieldId, value: value as object },
  });
}

// --- notes -----------------------------------------------------------------

export async function addNote(
  ctx: TenantContext,
  contactId: string,
  body: string,
) {
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!contact) return null;

  const note = await db.note.create({
    data: {
      workspaceId: ctx.workspaceId,
      contactId,
      authorUserId: ctx.userId,
      body,
    },
  });

  await db.$transaction([
    db.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        contactId,
        type: "NOTE",
        title: "Note added",
        body,
        actorUserId: ctx.userId,
      },
    }),
    db.contact.update({
      where: { id: contactId },
      data: { lastActivityAt: new Date() },
    }),
  ]);

  return note;
}

export async function deleteNote(ctx: TenantContext, noteId: string) {
  return db.note.deleteMany({
    where: { id: noteId, workspaceId: ctx.workspaceId },
  });
}

// --- tasks -----------------------------------------------------------------

export async function listTasks(
  ctx: TenantContext,
  filter: { open?: boolean; assigneeUserId?: string } = {},
) {
  return db.task.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(filter.open === true ? { completedAt: null } : {}),
      ...(filter.open === false ? { completedAt: { not: null } } : {}),
      ...(filter.assigneeUserId
        ? { assigneeUserId: filter.assigneeUserId }
        : {}),
    },
    orderBy: [{ completedAt: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      assignee: { select: { id: true, name: true, email: true } },
    },
    take: 200,
  });
}

export async function createTask(
  ctx: TenantContext,
  input: {
    title: string;
    contactId?: string | null;
    assigneeUserId?: string | null;
    dueAt?: Date | null;
    priority?: TaskPriority;
    description?: string | null;
  },
) {
  if (input.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: input.contactId, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!contact) return null;
  }

  return db.task.create({
    data: {
      workspaceId: ctx.workspaceId,
      title: input.title,
      description: input.description ?? null,
      contactId: input.contactId ?? null,
      assigneeUserId: input.assigneeUserId ?? ctx.userId,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? "NORMAL",
    },
  });
}

export async function toggleTask(
  ctx: TenantContext,
  taskId: string,
  done: boolean,
) {
  const result = await db.task.updateMany({
    where: { id: taskId, workspaceId: ctx.workspaceId },
    data: { completedAt: done ? new Date() : null },
  });
  return result.count > 0;
}

export async function deleteTask(ctx: TenantContext, taskId: string) {
  return db.task.deleteMany({
    where: { id: taskId, workspaceId: ctx.workspaceId },
  });
}

// --- activity --------------------------------------------------------------

export async function listActivity(
  ctx: TenantContext,
  options: { contactId?: string; take?: number } = {},
) {
  return db.activity.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(options.contactId ? { contactId: options.contactId } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: options.take ?? 50,
    include: {
      actor: { select: { id: true, name: true, email: true } },
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });
}

// --- dashboard -------------------------------------------------------------

export async function workspaceSummary(ctx: TenantContext) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [
    contactCount,
    newContacts,
    customerCount,
    openTasks,
    openDeals,
    recentActivity,
  ] = await Promise.all([
    db.contact.count({ where: { workspaceId: ctx.workspaceId } }),
    db.contact.count({
      where: { workspaceId: ctx.workspaceId, createdAt: { gte: thirtyDaysAgo } },
    }),
    db.contact.count({
      where: { workspaceId: ctx.workspaceId, status: "CUSTOMER" },
    }),
    db.task.count({
      where: { workspaceId: ctx.workspaceId, completedAt: null },
    }),
    db.deal.aggregate({
      where: { workspaceId: ctx.workspaceId, status: "OPEN" },
      _count: true,
      _sum: { value: true },
    }),
    listActivity(ctx, { take: 12 }),
  ]);

  return {
    contactCount,
    newContacts,
    customerCount,
    openTasks,
    openDealCount: openDeals._count,
    openDealValue: Number(openDeals._sum.value ?? 0),
    recentActivity,
  };
}
