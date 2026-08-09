/**
 * Segment predicate tree.
 *
 * This is the serialized shape stored in `Segment.definition`. It is also the
 * shape the contacts filter builder produces and — from Phase 2 — the shape an
 * automation if/else node evaluates. Keep it JSON-safe: no Dates, no undefined
 * in stored values.
 */

export const SEGMENT_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_set",
  "is_not_set",
  "gt",
  "gte",
  "lt",
  "lte",
  "before",
  "after",
  "within_days",
  "more_than_days_ago",
  "in",
  "not_in",
] as const;

export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

export type SegmentValue = string | number | boolean | string[] | null;

export interface SegmentRule {
  /**
   * One of:
   *  - a Contact column: "email", "firstName", "status", "createdAt", …
   *  - "tag" / "list": membership tests, value is an array of ids
   *  - "custom:<key>": a CustomField value on the contact
   */
  field: string;
  operator: SegmentOperator;
  value?: SegmentValue;
}

export interface SegmentGroup {
  combinator: "AND" | "OR";
  rules: Array<SegmentRule | SegmentGroup>;
}

export type SegmentNode = SegmentRule | SegmentGroup;

export function isGroup(node: SegmentNode): node is SegmentGroup {
  return (node as SegmentGroup).combinator !== undefined;
}

/** Fields the builder offers, and how each one compiles. */
export const CONTACT_STRING_FIELDS = [
  "email",
  "phone",
  "firstName",
  "lastName",
  "company",
  "jobTitle",
  "source",
  "timezone",
] as const;

export const CONTACT_DATE_FIELDS = [
  "createdAt",
  "updatedAt",
  "lastActivityAt",
] as const;

export const CONTACT_ENUM_FIELDS = ["status"] as const;

export const CONTACT_ID_FIELDS = ["ownerUserId"] as const;

export type ContactStringField = (typeof CONTACT_STRING_FIELDS)[number];
export type ContactDateField = (typeof CONTACT_DATE_FIELDS)[number];
export type ContactEnumField = (typeof CONTACT_ENUM_FIELDS)[number];
export type ContactIdField = (typeof CONTACT_ID_FIELDS)[number];

export class SegmentCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentCompileError";
  }
}

export const EMPTY_SEGMENT: SegmentGroup = { combinator: "AND", rules: [] };
