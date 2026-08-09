import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { evaluateSegment, type ContactSnapshot } from "./evaluate";
import { compileSegmentForWorkspace } from "./compile";
import { SegmentCompileError, type SegmentNode } from "./types";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function snapshot(overrides: Partial<ContactSnapshot> = {}): ContactSnapshot {
  return {
    email: "ava@acme.com",
    phone: "+15125550100",
    firstName: "Ava",
    lastName: "Alvarez",
    company: "Acme Dental",
    jobTitle: null,
    source: "website-form",
    timezone: null,
    status: "CUSTOMER",
    ownerUserId: null,
    createdAt: new Date("2026-01-10T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    lastActivityAt: new Date("2026-06-10T00:00:00.000Z"),
    tagIds: ["tag_vip"],
    listIds: ["list_news"],
    customFields: { lifetime_value: 4200, plan_tier: "gold" },
    ...overrides,
  };
}

function check(node: SegmentNode, contact = snapshot()) {
  return evaluateSegment(node, contact, { now: NOW });
}

describe("groups", () => {
  it("treats an empty group as matching, like the SQL backend", () => {
    expect(check({ combinator: "AND", rules: [] })).toBe(true);
  });

  it("ANDs and ORs", () => {
    expect(
      check({
        combinator: "AND",
        rules: [
          { field: "status", operator: "equals", value: "CUSTOMER" },
          { field: "company", operator: "contains", value: "dental" },
        ],
      }),
    ).toBe(true);

    expect(
      check({
        combinator: "AND",
        rules: [
          { field: "status", operator: "equals", value: "LEAD" },
          { field: "company", operator: "contains", value: "dental" },
        ],
      }),
    ).toBe(false);

    expect(
      check({
        combinator: "OR",
        rules: [
          { field: "status", operator: "equals", value: "LEAD" },
          { field: "company", operator: "contains", value: "dental" },
        ],
      }),
    ).toBe(true);
  });
});

describe("text", () => {
  it("compares case-insensitively", () => {
    expect(check({ field: "email", operator: "contains", value: "ACME" })).toBe(
      true,
    );
    expect(check({ field: "firstName", operator: "equals", value: "ava" })).toBe(
      true,
    );
  });

  it("treats null as unset and satisfies negations", () => {
    const blank = snapshot({ company: null });
    expect(check({ field: "company", operator: "is_not_set" }, blank)).toBe(true);
    expect(
      check({ field: "company", operator: "not_contains", value: "x" }, blank),
    ).toBe(true);
    expect(
      check({ field: "company", operator: "contains", value: "x" }, blank),
    ).toBe(false);
  });
});

describe("dates", () => {
  it("evaluates within_days against the injected clock", () => {
    expect(
      check({ field: "lastActivityAt", operator: "within_days", value: 30 }),
    ).toBe(true);
    expect(
      check({ field: "lastActivityAt", operator: "within_days", value: 2 }),
    ).toBe(false);
  });

  it("evaluates more_than_days_ago", () => {
    expect(
      check({ field: "createdAt", operator: "more_than_days_ago", value: 100 }),
    ).toBe(true);
  });

  it("returns false for a null date on a comparison", () => {
    const quiet = snapshot({ lastActivityAt: null });
    expect(
      check({ field: "lastActivityAt", operator: "within_days", value: 30 }, quiet),
    ).toBe(false);
    expect(
      check({ field: "lastActivityAt", operator: "is_not_set" }, quiet),
    ).toBe(true);
  });
});

describe("membership", () => {
  it("matches tags and lists", () => {
    expect(
      check({ field: "tag", operator: "in", value: ["tag_vip", "tag_x"] }),
    ).toBe(true);
    expect(check({ field: "tag", operator: "not_in", value: ["tag_vip"] })).toBe(
      false,
    );
    expect(check({ field: "list", operator: "equals", value: "list_news" })).toBe(
      true,
    );
  });

  it("treats an untagged contact as matching not_in", () => {
    const bare = snapshot({ tagIds: [] });
    expect(
      check({ field: "tag", operator: "not_in", value: ["tag_vip"] }, bare),
    ).toBe(true);
  });
});

describe("custom fields", () => {
  it("compares numbers and strings", () => {
    expect(
      check({ field: "custom:lifetime_value", operator: "gte", value: 4000 }),
    ).toBe(true);
    expect(
      check({ field: "custom:plan_tier", operator: "equals", value: "gold" }),
    ).toBe(true);
  });

  it("treats a missing key as unset and satisfies negation", () => {
    const bare = snapshot({ customFields: {} });
    expect(
      check({ field: "custom:plan_tier", operator: "is_not_set" }, bare),
    ).toBe(true);
    expect(
      check(
        { field: "custom:plan_tier", operator: "not_equals", value: "gold" },
        bare,
      ),
    ).toBe(true);
  });
});

describe("errors", () => {
  it("throws on an unknown field rather than silently passing", () => {
    // Returning false would quietly drop people out of an automation; throwing
    // surfaces the bad config instead.
    expect(() => check({ field: "passwordHash", operator: "is_set" })).toThrow(
      SegmentCompileError,
    );
  });
});

// ---------------------------------------------------------------------------
// Parity: the two backends must agree on the same data.
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const db = DATABASE_URL
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
  : null;

describe.skipIf(!db)("parity with the SQL backend", () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  let orgId: string;
  let workspaceId: string;
  let tagId: string;
  const snapshots: Array<{ id: string; snap: ContactSnapshot }> = [];

  beforeAll(async () => {
    const org = await db!.organization.create({
      data: { name: `Parity ${suffix}`, slug: `parity-${suffix}` },
    });
    orgId = org.id;

    const workspace = await db!.workspace.create({
      data: { organizationId: orgId, name: "Parity", slug: `p-${suffix}` },
    });
    workspaceId = workspace.id;

    const tag = await db!.tag.create({
      data: { workspaceId, name: `vip-${suffix}` },
    });
    tagId = tag.id;

    const field = await db!.customField.create({
      data: { workspaceId, key: "plan_tier", label: "Plan tier", type: "TEXT" },
    });

    const fixtures = [
      {
        email: `ann-${suffix}@acme.com`,
        firstName: "Ann",
        company: "Acme Dental",
        status: "CUSTOMER" as const,
        lastActivityAt: new Date("2026-06-10T00:00:00.000Z"),
        tagged: true,
        plan: "gold",
      },
      {
        email: `bob-${suffix}@other.com`,
        firstName: "Bob",
        company: null,
        status: "LEAD" as const,
        lastActivityAt: new Date("2026-01-01T00:00:00.000Z"),
        tagged: false,
        plan: null,
      },
      {
        email: null,
        firstName: "Cy",
        company: "Acme HVAC",
        status: "CUSTOMER" as const,
        lastActivityAt: null,
        tagged: true,
        plan: "silver",
      },
    ];

    for (const fixture of fixtures) {
      const contact = await db!.contact.create({
        data: {
          workspaceId,
          email: fixture.email,
          firstName: fixture.firstName,
          company: fixture.company,
          status: fixture.status,
          lastActivityAt: fixture.lastActivityAt,
          createdAt: new Date("2026-01-10T00:00:00.000Z"),
        },
      });

      if (fixture.tagged) {
        await db!.contactTag.create({ data: { contactId: contact.id, tagId } });
      }
      if (fixture.plan) {
        await db!.contactFieldValue.create({
          data: { contactId: contact.id, fieldId: field.id, value: fixture.plan },
        });
      }

      snapshots.push({
        id: contact.id,
        snap: {
          email: fixture.email,
          phone: null,
          firstName: fixture.firstName,
          lastName: null,
          company: fixture.company,
          jobTitle: null,
          source: null,
          timezone: null,
          status: fixture.status,
          ownerUserId: null,
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
          lastActivityAt: fixture.lastActivityAt,
          tagIds: fixture.tagged ? [tagId] : [],
          listIds: [],
          customFields: fixture.plan ? { plan_tier: fixture.plan } : {},
        },
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.$disconnect();
  });

  const cases: Array<[string, SegmentNode]> = [
    ["status equals", { field: "status", operator: "equals", value: "CUSTOMER" }],
    [
      "company contains, case-insensitive",
      { field: "company", operator: "contains", value: "acme" },
    ],
    [
      "company not_contains (null must match)",
      { field: "company", operator: "not_contains", value: "acme" },
    ],
    ["email is_not_set", { field: "email", operator: "is_not_set" }],
    [
      "lastActivityAt within 30 days",
      { field: "lastActivityAt", operator: "within_days", value: 30 },
    ],
    [
      "lastActivityAt more than 30 days ago",
      { field: "lastActivityAt", operator: "more_than_days_ago", value: 30 },
    ],
    ["custom plan_tier is_not_set", { field: "custom:plan_tier", operator: "is_not_set" }],
    [
      "custom plan_tier not gold",
      { field: "custom:plan_tier", operator: "not_equals", value: "gold" },
    ],
    [
      "OR across status and company",
      {
        combinator: "OR",
        rules: [
          { field: "status", operator: "equals", value: "LEAD" },
          { field: "company", operator: "contains", value: "hvac" },
        ],
      },
    ],
  ];

  it.each(cases)("agrees on: %s", async (_label, node) => {
    // Tag rules need the generated id, so patch it in where relevant.
    const rows = await db!.contact.findMany({
      where: compileSegmentForWorkspace(workspaceId, node, { now: NOW }),
      select: { id: true },
    });
    const fromSql = new Set(rows.map((row) => row.id));

    const fromMemory = new Set(
      snapshots
        .filter(({ snap }) => evaluateSegment(node, snap, { now: NOW }))
        .map(({ id }) => id),
    );

    expect([...fromMemory].sort()).toEqual([...fromSql].sort());
  });

  it("agrees on tag membership", async () => {
    const node: SegmentNode = {
      field: "tag",
      operator: "in",
      value: [tagId],
    };

    const rows = await db!.contact.findMany({
      where: compileSegmentForWorkspace(workspaceId, node),
      select: { id: true },
    });

    const fromMemory = snapshots
      .filter(({ snap }) => evaluateSegment(node, snap))
      .map(({ id }) => id);

    expect(fromMemory.sort()).toEqual(rows.map((row) => row.id).sort());
  });
});
