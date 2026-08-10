import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { buildContactWhere } from "./contacts";
import type { TenantContext } from "@/lib/tenant";

/**
 * Cross-tenant leakage is the failure mode that ends an agency platform: one
 * client seeing another client's contact list. These tests run the real query
 * builders against a real database with two workspaces populated, and assert
 * that a context for one never returns rows from the other.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const db = DATABASE_URL
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
  : null;

function contextFor(
  organizationId: string,
  workspaceId: string,
  userId: string,
): TenantContext {
  return {
    userId,
    organizationId,
    workspaceId,
    role: "ADMIN",
    isStaff: true,
    workspace: { id: workspaceId, name: "ws", slug: "ws", timezone: "UTC" },
    organization: { id: organizationId, name: "org", slug: "org" },
  };
}

describe.skipIf(!db)("tenant isolation", () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  let orgId: string;
  let workspaceA: string;
  let workspaceB: string;
  let userId: string;

  beforeAll(async () => {
    const user = await db!.user.create({
      data: { email: `isolation-${suffix}@example.com`, name: "Isolation" },
    });
    userId = user.id;

    const org = await db!.organization.create({
      data: { name: `Isolation ${suffix}`, slug: `isolation-${suffix}` },
    });
    orgId = org.id;

    const a = await db!.workspace.create({
      data: { organizationId: orgId, name: "Client A", slug: `a-${suffix}` },
    });
    const b = await db!.workspace.create({
      data: { organizationId: orgId, name: "Client B", slug: `b-${suffix}` },
    });
    workspaceA = a.id;
    workspaceB = b.id;

    await db!.contact.createMany({
      data: [
        { workspaceId: workspaceA, email: `a1-${suffix}@x.com`, firstName: "Ann" },
        { workspaceId: workspaceA, email: `a2-${suffix}@x.com`, firstName: "Abe" },
        { workspaceId: workspaceB, email: `b1-${suffix}@x.com`, firstName: "Bob" },
      ],
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("returns only the tenant's own contacts", async () => {
    const ctx = contextFor(orgId, workspaceA, userId);
    const rows = await db!.contact.findMany({
      where: buildContactWhere(ctx, {}),
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.workspaceId === workspaceA)).toBe(true);
  });

  it("cannot be widened by a search term", async () => {
    const ctx = contextFor(orgId, workspaceA, userId);
    const rows = await db!.contact.findMany({
      where: buildContactWhere(ctx, { search: "Bob" }),
    });
    expect(rows).toHaveLength(0);
  });

  it("cannot be widened by an OR segment", async () => {
    const ctx = contextFor(orgId, workspaceA, userId);
    // An OR at the top level is the classic way a tenant filter gets bypassed.
    const rows = await db!.contact.findMany({
      where: buildContactWhere(ctx, {
        segment: {
          combinator: "OR",
          rules: [
            { field: "firstName", operator: "equals", value: "Ann" },
            { field: "firstName", operator: "equals", value: "Bob" },
          ],
        },
      }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.firstName).toBe("Ann");
  });

  it("returns nothing for a workspace with no rows rather than everything", async () => {
    const empty = await db!.workspace.create({
      data: { organizationId: orgId, name: "Empty", slug: `e-${suffix}` },
    });
    const ctx = contextFor(orgId, empty.id, userId);
    const rows = await db!.contact.findMany({
      where: buildContactWhere(ctx, {}),
    });
    expect(rows).toHaveLength(0);
  });

  it("scopes a lookup by id to the workspace", async () => {
    const foreign = await db!.contact.findFirst({
      where: { workspaceId: workspaceB },
    });
    const ctx = contextFor(orgId, workspaceA, userId);

    const row = await db!.contact.findFirst({
      where: { id: foreign!.id, workspaceId: ctx.workspaceId },
    });
    expect(row).toBeNull();
  });
});
