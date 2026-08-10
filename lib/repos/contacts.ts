import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ContactStatus } from "@/generated/prisma/enums";
import { compileSegmentForWorkspace } from "@/lib/segments/compile";
import type { SegmentNode } from "@/lib/segments/types";
import { normalizeEmail, normalizePhone } from "@/lib/utils";
import type { TenantContext } from "@/lib/tenant";

export const CONTACT_PAGE_SIZE = 50;

export interface ListContactsParams {
  search?: string;
  segment?: SegmentNode | null;
  tagIds?: string[];
  listIds?: string[];
  status?: ContactStatus | null;
  page?: number;
  pageSize?: number;
  sort?: "recent" | "created" | "name";
}

/**
 * Build the `where` for a contacts query.
 *
 * Every branch starts from `compileSegmentForWorkspace`, which guarantees the
 * workspace predicate is present; the UI filters are AND-ed on top and can only
 * narrow the result, never widen past the tenant.
 */
export function buildContactWhere(
  ctx: TenantContext,
  params: ListContactsParams,
): Prisma.ContactWhereInput {
  const clauses: Prisma.ContactWhereInput[] = [
    compileSegmentForWorkspace(ctx.workspaceId, params.segment ?? null),
  ];

  if (params.search?.trim()) {
    const term = params.search.trim();
    clauses.push({
      OR: [
        { email: { contains: term, mode: "insensitive" } },
        { phone: { contains: term, mode: "insensitive" } },
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { company: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  if (params.tagIds?.length) {
    clauses.push({ tags: { some: { tagId: { in: params.tagIds } } } });
  }

  if (params.listIds?.length) {
    clauses.push({ lists: { some: { listId: { in: params.listIds } } } });
  }

  if (params.status) {
    clauses.push({ status: params.status });
  }

  return clauses.length === 1 ? clauses[0]! : { AND: clauses };
}

function orderFor(
  sort: ListContactsParams["sort"],
): Prisma.ContactOrderByWithRelationInput[] {
  switch (sort) {
    case "created":
      return [{ createdAt: "desc" }];
    case "name":
      return [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }];
    default:
      // Nulls sort last so contacts that have actually done something lead.
      return [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
  }
}

export async function listContacts(
  ctx: TenantContext,
  params: ListContactsParams = {},
) {
  const pageSize = params.pageSize ?? CONTACT_PAGE_SIZE;
  const page = Math.max(1, params.page ?? 1);
  const where = buildContactWhere(ctx, params);

  const [items, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: orderFor(params.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        tags: { include: { tag: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    db.contact.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function countContacts(
  ctx: TenantContext,
  params: ListContactsParams = {},
) {
  return db.contact.count({ where: buildContactWhere(ctx, params) });
}

export async function getContact(ctx: TenantContext, contactId: string) {
  return db.contact.findFirst({
    // workspaceId in the where, not just the id — an id from another tenant
    // must return null rather than the row.
    where: { id: contactId, workspaceId: ctx.workspaceId },
    include: {
      tags: { include: { tag: true } },
      lists: { include: { list: true } },
      fieldValues: { include: { field: true } },
      owner: { select: { id: true, name: true, email: true } },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
      tasks: {
        orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }],
        include: { assignee: { select: { id: true, name: true, email: true } } },
      },
      deals: { include: { stage: true, pipeline: true } },
    },
  });
}

export interface ContactInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  status?: ContactStatus;
  source?: string | null;
  timezone?: string | null;
  ownerUserId?: string | null;
}

export async function createContact(ctx: TenantContext, input: ContactInput) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  const contact = await db.contact.create({
    data: {
      workspaceId: ctx.workspaceId,
      email,
      phone,
      firstName: input.firstName?.trim() || null,
      lastName: input.lastName?.trim() || null,
      company: input.company?.trim() || null,
      jobTitle: input.jobTitle?.trim() || null,
      status: input.status ?? "LEAD",
      source: input.source?.trim() || "manual",
      timezone: input.timezone || null,
      ownerUserId: input.ownerUserId || null,
      lastActivityAt: new Date(),
    },
  });

  await db.activity.create({
    data: {
      workspaceId: ctx.workspaceId,
      contactId: contact.id,
      type: "SYSTEM",
      title: "Contact created",
      actorUserId: ctx.userId,
    },
  });

  return contact;
}

export async function updateContact(
  ctx: TenantContext,
  contactId: string,
  input: ContactInput,
) {
  const existing = await db.contact.findFirst({
    where: { id: contactId, workspaceId: ctx.workspaceId },
    select: { id: true, status: true },
  });
  if (!existing) return null;

  const data: Prisma.ContactUpdateInput = {};
  if (input.email !== undefined) data.email = normalizeEmail(input.email);
  if (input.phone !== undefined) data.phone = normalizePhone(input.phone);
  if (input.firstName !== undefined)
    data.firstName = input.firstName?.trim() || null;
  if (input.lastName !== undefined)
    data.lastName = input.lastName?.trim() || null;
  if (input.company !== undefined) data.company = input.company?.trim() || null;
  if (input.jobTitle !== undefined)
    data.jobTitle = input.jobTitle?.trim() || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.source !== undefined) data.source = input.source?.trim() || null;
  if (input.timezone !== undefined) data.timezone = input.timezone || null;
  if (input.ownerUserId !== undefined) {
    data.owner = input.ownerUserId
      ? { connect: { id: input.ownerUserId } }
      : { disconnect: true };
  }

  const contact = await db.contact.update({ where: { id: contactId }, data });

  if (input.status && input.status !== existing.status) {
    await db.activity.create({
      data: {
        workspaceId: ctx.workspaceId,
        contactId,
        type: "STATUS_CHANGED",
        title: `Status changed from ${existing.status} to ${input.status}`,
        actorUserId: ctx.userId,
      },
    });
  }

  return contact;
}

export async function deleteContacts(ctx: TenantContext, contactIds: string[]) {
  if (contactIds.length === 0) return 0;
  const result = await db.contact.deleteMany({
    where: { id: { in: contactIds }, workspaceId: ctx.workspaceId },
  });
  return result.count;
}

export async function setContactTags(
  ctx: TenantContext,
  contactIds: string[],
  tagIds: string[],
  mode: "add" | "remove",
) {
  if (contactIds.length === 0 || tagIds.length === 0) return 0;

  // Re-scope both sides: ids arrive from the client and must be proven to
  // belong to this workspace before they touch the join table.
  const [contacts, tags] = await Promise.all([
    db.contact.findMany({
      where: { id: { in: contactIds }, workspaceId: ctx.workspaceId },
      select: { id: true },
    }),
    db.tag.findMany({
      where: { id: { in: tagIds }, workspaceId: ctx.workspaceId },
      select: { id: true, name: true },
    }),
  ]);

  if (contacts.length === 0 || tags.length === 0) return 0;

  if (mode === "add") {
    await db.contactTag.createMany({
      data: contacts.flatMap((contact) =>
        tags.map((tag) => ({ contactId: contact.id, tagId: tag.id })),
      ),
      skipDuplicates: true,
    });
  } else {
    await db.contactTag.deleteMany({
      where: {
        contactId: { in: contacts.map((c) => c.id) },
        tagId: { in: tags.map((t) => t.id) },
      },
    });
  }

  await db.activity.createMany({
    data: contacts.map((contact) => ({
      workspaceId: ctx.workspaceId,
      contactId: contact.id,
      type: mode === "add" ? ("TAG_ADDED" as const) : ("TAG_REMOVED" as const),
      title: `${mode === "add" ? "Tagged" : "Untagged"} ${tags
        .map((t) => t.name)
        .join(", ")}`,
      actorUserId: ctx.userId,
    })),
  });

  return contacts.length;
}

export async function setContactLists(
  ctx: TenantContext,
  contactIds: string[],
  listIds: string[],
  mode: "add" | "remove",
) {
  if (contactIds.length === 0 || listIds.length === 0) return 0;

  const [contacts, lists] = await Promise.all([
    db.contact.findMany({
      where: { id: { in: contactIds }, workspaceId: ctx.workspaceId },
      select: { id: true },
    }),
    db.list.findMany({
      where: { id: { in: listIds }, workspaceId: ctx.workspaceId },
      select: { id: true },
    }),
  ]);

  if (contacts.length === 0 || lists.length === 0) return 0;

  if (mode === "add") {
    await db.contactList.createMany({
      data: contacts.flatMap((contact) =>
        lists.map((list) => ({ contactId: contact.id, listId: list.id })),
      ),
      skipDuplicates: true,
    });
  } else {
    await db.contactList.deleteMany({
      where: {
        contactId: { in: contacts.map((c) => c.id) },
        listId: { in: lists.map((l) => l.id) },
      },
    });
  }

  return contacts.length;
}

export interface ImportRow {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  source?: string | null;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

/**
 * Upsert a batch of rows, matching on email first and phone second.
 *
 * Rows without either identifier are skipped rather than inserted: an
 * unreachable contact cannot be messaged or deduplicated later, and silently
 * accepting them is how a CRM fills with junk.
 */
export async function importContacts(
  ctx: TenantContext,
  rows: ImportRow[],
  options: { tagIds?: string[]; listIds?: string[]; source?: string } = {},
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const touched: string[] = [];

  for (const [index, row] of rows.entries()) {
    const email = normalizeEmail(row.email);
    const phone = normalizePhone(row.phone);

    if (!email && !phone) {
      summary.skipped += 1;
      if (row.email || row.phone) {
        summary.errors.push({
          row: index + 1,
          reason: "Email and phone were both unusable",
        });
      }
      continue;
    }

    const existing = await db.contact.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: { id: true },
    });

    const data = {
      firstName: row.firstName?.trim() || undefined,
      lastName: row.lastName?.trim() || undefined,
      company: row.company?.trim() || undefined,
      jobTitle: row.jobTitle?.trim() || undefined,
    };

    try {
      if (existing) {
        await db.contact.update({
          where: { id: existing.id },
          // Only fill blanks — an import must not erase better data already in
          // the CRM.
          data: { ...data, email: email ?? undefined, phone: phone ?? undefined },
        });
        touched.push(existing.id);
        summary.updated += 1;
      } else {
        const created = await db.contact.create({
          data: {
            workspaceId: ctx.workspaceId,
            email,
            phone,
            ...data,
            source: options.source ?? row.source?.trim() ?? "import",
            status: "LEAD",
            lastActivityAt: new Date(),
          },
        });
        touched.push(created.id);
        summary.created += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      summary.errors.push({
        row: index + 1,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (touched.length > 0) {
    if (options.tagIds?.length) {
      await setContactTags(ctx, touched, options.tagIds, "add");
    }
    if (options.listIds?.length) {
      await setContactLists(ctx, touched, options.listIds, "add");
    }
    await db.activity.createMany({
      data: touched.map((contactId) => ({
        workspaceId: ctx.workspaceId,
        contactId,
        type: "IMPORT" as const,
        title: "Imported from CSV",
        actorUserId: ctx.userId,
      })),
    });
  }

  return summary;
}

export async function listContactsForExport(
  ctx: TenantContext,
  params: ListContactsParams = {},
) {
  return db.contact.findMany({
    where: buildContactWhere(ctx, params),
    orderBy: { createdAt: "desc" },
    include: { tags: { include: { tag: true } } },
    take: 50_000,
  });
}
