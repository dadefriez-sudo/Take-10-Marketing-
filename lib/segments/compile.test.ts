import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  compileSegment,
  compileSegmentForWorkspace,
  parseSegmentDefinition,
} from "./compile";
import { SegmentCompileError, type SegmentGroup } from "./types";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function group(...rules: SegmentGroup["rules"]): SegmentGroup {
  return { combinator: "AND", rules };
}

describe("workspace scoping", () => {
  it("scopes a null segment to the workspace alone", () => {
    expect(compileSegmentForWorkspace("ws_1", null)).toEqual({
      workspaceId: "ws_1",
    });
  });

  it("scopes an empty group to the workspace alone", () => {
    expect(compileSegmentForWorkspace("ws_1", group())).toEqual({
      workspaceId: "ws_1",
    });
  });

  it("always ANDs the workspace in, never lets a rule replace it", () => {
    const where = compileSegmentForWorkspace(
      "ws_1",
      group({ field: "status", operator: "equals", value: "CUSTOMER" }),
    );
    expect(where).toEqual({
      AND: [{ workspaceId: "ws_1" }, { status: "CUSTOMER" }],
    });
  });

  it("keeps the workspace scope outside an OR group", () => {
    const where = compileSegmentForWorkspace("ws_1", {
      combinator: "OR",
      rules: [
        { field: "status", operator: "equals", value: "LEAD" },
        { field: "status", operator: "equals", value: "CUSTOMER" },
      ],
    });
    // The OR must be nested, otherwise it would widen past the workspace.
    expect(where).toEqual({
      AND: [
        { workspaceId: "ws_1" },
        { OR: [{ status: "LEAD" }, { status: "CUSTOMER" }] },
      ],
    });
  });
});

describe("groups", () => {
  it("returns a bare fragment for a single rule instead of a 1-item AND", () => {
    expect(
      compileSegment(group({ field: "email", operator: "is_set" })),
    ).toEqual({ email: { not: null } });
  });

  it("drops empty nested groups", () => {
    expect(
      compileSegment(
        group(
          { field: "email", operator: "is_set" },
          { combinator: "OR", rules: [] },
        ),
      ),
    ).toEqual({ email: { not: null } });
  });

  it("nests mixed combinators", () => {
    const where = compileSegment(
      group(
        { field: "status", operator: "equals", value: "LEAD" },
        {
          combinator: "OR",
          rules: [
            { field: "source", operator: "equals", value: "website" },
            { field: "source", operator: "equals", value: "referral" },
          ],
        },
      ),
    );
    expect(where).toEqual({
      AND: [
        { status: "LEAD" },
        {
          OR: [
            { source: { equals: "website", mode: "insensitive" } },
            { source: { equals: "referral", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("rejects an unknown combinator", () => {
    expect(() =>
      compileSegment({
        combinator: "XOR",
        rules: [],
      } as unknown as SegmentGroup),
    ).toThrow(SegmentCompileError);
  });
});

describe("text fields", () => {
  it("matches case-insensitively", () => {
    expect(
      compileSegment({
        field: "email",
        operator: "contains",
        value: "@acme.com",
      }),
    ).toEqual({ email: { contains: "@acme.com", mode: "insensitive" } });
  });

  it("keeps unset rows in a negation", () => {
    // Postgres would drop NULLs from a bare NOT, quietly removing everyone
    // with no company from a "does not contain" audience. The explicit null
    // branch keeps SQL in step with the in-memory evaluator.
    expect(
      compileSegment({
        field: "company",
        operator: "not_contains",
        value: "test",
      }),
    ).toEqual({
      OR: [
        { NOT: { company: { contains: "test", mode: "insensitive" } } },
        { company: null },
      ],
    });
  });

  it.each([
    ["starts_with", "startsWith"],
    ["ends_with", "endsWith"],
  ] as const)("maps %s", (operator, prismaKey) => {
    expect(
      compileSegment({ field: "firstName", operator, value: "Jo" }),
    ).toEqual({ firstName: { [prismaKey]: "Jo", mode: "insensitive" } });
  });

  it("handles is_set / is_not_set without a value", () => {
    expect(compileSegment({ field: "phone", operator: "is_not_set" })).toEqual({
      phone: null,
    });
  });

  it("rejects a text rule that needs a value but has none", () => {
    expect(() =>
      compileSegment({ field: "email", operator: "contains" }),
    ).toThrow(/needs a text value/);
  });

  it("rejects an operator that makes no sense for text", () => {
    expect(() =>
      compileSegment({ field: "email", operator: "within_days", value: 7 }),
    ).toThrow(/not valid for text field/);
  });
});

describe("date fields", () => {
  it("computes within_days from the injected clock", () => {
    expect(
      compileSegment(
        { field: "createdAt", operator: "within_days", value: 30 },
        { now: NOW },
      ),
    ).toEqual({ createdAt: { gte: new Date("2026-05-16T12:00:00.000Z") } });
  });

  it("computes more_than_days_ago from the injected clock", () => {
    expect(
      compileSegment(
        { field: "lastActivityAt", operator: "more_than_days_ago", value: 90 },
        { now: NOW },
      ),
    ).toEqual({ lastActivityAt: { lt: new Date("2026-03-17T12:00:00.000Z") } });
  });

  it("treats equals on a date as a whole UTC day", () => {
    expect(
      compileSegment({
        field: "createdAt",
        operator: "equals",
        value: "2026-03-04T17:45:00.000Z",
      }),
    ).toEqual({
      createdAt: {
        gte: new Date("2026-03-04T00:00:00.000Z"),
        lt: new Date("2026-03-05T00:00:00.000Z"),
      },
    });
  });

  it("maps before/after to lt/gt", () => {
    expect(
      compileSegment({
        field: "createdAt",
        operator: "before",
        value: "2026-01-01",
      }),
    ).toEqual({ createdAt: { lt: new Date("2026-01-01T00:00:00.000Z") } });
  });

  it("rejects an unparseable date", () => {
    expect(() =>
      compileSegment({
        field: "createdAt",
        operator: "after",
        value: "not-a-date",
      }),
    ).toThrow(/invalid date/);
  });

  it("does not silently accept a numeric string for within_days", () => {
    // Numeric strings are fine (form inputs are strings); garbage is not.
    expect(
      compileSegment(
        { field: "createdAt", operator: "within_days", value: "7" },
        { now: NOW },
      ),
    ).toEqual({ createdAt: { gte: new Date("2026-06-08T12:00:00.000Z") } });

    expect(() =>
      compileSegment({
        field: "createdAt",
        operator: "within_days",
        value: "seven",
      }),
    ).toThrow(/non-numeric/);
  });
});

describe("status enum", () => {
  it("compiles equals to a bare value", () => {
    expect(
      compileSegment({ field: "status", operator: "equals", value: "ACTIVE" }),
    ).toEqual({ status: "ACTIVE" });
  });

  it("compiles in to an array", () => {
    expect(
      compileSegment({
        field: "status",
        operator: "in",
        value: ["LEAD", "CUSTOMER"],
      }),
    ).toEqual({ status: { in: ["LEAD", "CUSTOMER"] } });
  });

  it("rejects a status that is not in the enum", () => {
    expect(() =>
      compileSegment({ field: "status", operator: "equals", value: "VIP" }),
    ).toThrow(/Unknown contact status/);
  });
});

describe("tag and list membership", () => {
  it("compiles tag in to a some() on the join table", () => {
    expect(
      compileSegment({
        field: "tag",
        operator: "in",
        value: ["tag_1", "tag_2"],
      }),
    ).toEqual({ tags: { some: { tagId: { in: ["tag_1", "tag_2"] } } } });
  });

  it("compiles tag not_in to none(), which also matches untagged contacts", () => {
    expect(
      compileSegment({ field: "tag", operator: "not_in", value: ["tag_1"] }),
    ).toEqual({ tags: { none: { tagId: { in: ["tag_1"] } } } });
  });

  it("accepts a single id for equals", () => {
    expect(
      compileSegment({ field: "list", operator: "equals", value: "list_1" }),
    ).toEqual({ lists: { some: { listId: { in: ["list_1"] } } } });
  });

  it("compiles has-any-tag", () => {
    expect(compileSegment({ field: "tag", operator: "is_set" })).toEqual({
      tags: { some: {} },
    });
  });

  it("rejects an empty id array rather than matching everything", () => {
    expect(() =>
      compileSegment({ field: "tag", operator: "in", value: [] }),
    ).toThrow(/at least one value/);
  });
});

describe("custom fields", () => {
  it("compiles equals against the JSON value", () => {
    expect(
      compileSegment({
        field: "custom:plan_tier",
        operator: "equals",
        value: "gold",
      }),
    ).toEqual({
      fieldValues: {
        some: { field: { key: "plan_tier" }, value: { equals: "gold" } },
      },
    });
  });

  it("wraps negation in NOT so a missing row also matches", () => {
    expect(
      compileSegment({
        field: "custom:plan_tier",
        operator: "not_equals",
        value: "gold",
      }),
    ).toEqual({
      NOT: {
        fieldValues: {
          some: { field: { key: "plan_tier" }, value: { equals: "gold" } },
        },
      },
    });
  });

  it("treats a missing row and a JSON null as both unset", () => {
    expect(
      compileSegment({ field: "custom:plan_tier", operator: "is_not_set" }),
    ).toEqual({
      OR: [
        { fieldValues: { none: { field: { key: "plan_tier" } } } },
        {
          fieldValues: {
            some: {
              field: { key: "plan_tier" },
              value: { equals: Prisma.AnyNull },
            },
          },
        },
      ],
    });
  });

  it("compiles numeric comparison", () => {
    expect(
      compileSegment({
        field: "custom:lifetime_value",
        operator: "gte",
        value: 5000,
      }),
    ).toEqual({
      fieldValues: {
        some: { field: { key: "lifetime_value" }, value: { gte: 5000 } },
      },
    });
  });

  it("rejects a custom rule with no key", () => {
    expect(() =>
      compileSegment({ field: "custom:", operator: "is_set" }),
    ).toThrow(/missing a key/);
  });
});

describe("unknown fields", () => {
  it("throws rather than silently ignoring the rule", () => {
    // Silently dropping an unrecognized rule would widen the audience — a
    // filter meant to exclude people would quietly include them.
    expect(() =>
      compileSegment({ field: "passwordHash", operator: "is_set" }),
    ).toThrow(/Unknown segment field/);
  });
});

describe("parseSegmentDefinition", () => {
  it("accepts a well-formed group", () => {
    const definition = { combinator: "AND", rules: [] };
    expect(parseSegmentDefinition(definition)).toEqual(definition);
  });

  it.each([null, undefined, 42, "AND", {}, { combinator: "AND" }])(
    "rejects malformed definition %s",
    (value) => {
      expect(() => parseSegmentDefinition(value)).toThrow(SegmentCompileError);
    },
  );
});
