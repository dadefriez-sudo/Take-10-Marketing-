import {
  CONTACT_DATE_FIELDS,
  CONTACT_ENUM_FIELDS,
  CONTACT_ID_FIELDS,
  CONTACT_STRING_FIELDS,
  SegmentCompileError,
  isGroup,
  type SegmentGroup,
  type SegmentNode,
  type SegmentRule,
} from "./types";

/**
 * In-memory evaluation of the same predicate tree that `compile.ts` turns into
 * a Prisma `where`.
 *
 * There are two backends for one predicate language: SQL for "show me this
 * list", and this one for "does *this* contact match, right now" — which is
 * what an automation's if/else node asks, thousands of times, without wanting a
 * database round trip per contact.
 *
 * The two must agree. `evaluate.parity.test.ts` pins the cases where they could
 * plausibly drift (case-insensitivity, null handling, negation semantics).
 */

export interface ContactSnapshot {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  source: string | null;
  timezone: string | null;
  status: string;
  ownerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date | null;
  tagIds: string[];
  listIds: string[];
  /** Keyed by CustomField.key. */
  customFields: Record<string, unknown>;
}

export interface EvaluateOptions {
  now?: Date;
}

const STRING_FIELDS = new Set<string>(CONTACT_STRING_FIELDS);
const DATE_FIELDS = new Set<string>(CONTACT_DATE_FIELDS);
const ENUM_FIELDS = new Set<string>(CONTACT_ENUM_FIELDS);
const ID_FIELDS = new Set<string>(CONTACT_ID_FIELDS);

export function evaluateSegment(
  node: SegmentNode,
  contact: ContactSnapshot,
  options: EvaluateOptions = {},
): boolean {
  return evaluateNode(node, contact, options.now ?? new Date());
}

function evaluateNode(
  node: SegmentNode,
  contact: ContactSnapshot,
  now: Date,
): boolean {
  if (isGroup(node)) return evaluateGroup(node, contact, now);
  return evaluateRule(node, contact, now);
}

function evaluateGroup(
  group: SegmentGroup,
  contact: ContactSnapshot,
  now: Date,
): boolean {
  if (group.combinator !== "AND" && group.combinator !== "OR") {
    throw new SegmentCompileError(
      `Unknown combinator "${String(group.combinator)}"`,
    );
  }

  // Matches compile.ts: an empty group matches everything, not nothing.
  if (group.rules.length === 0) return true;

  return group.combinator === "AND"
    ? group.rules.every((rule) => evaluateNode(rule, contact, now))
    : group.rules.some((rule) => evaluateNode(rule, contact, now));
}

function evaluateRule(
  rule: SegmentRule,
  contact: ContactSnapshot,
  now: Date,
): boolean {
  const { field } = rule;

  if (field === "tag") return evaluateMembership(rule, contact.tagIds);
  if (field === "list") return evaluateMembership(rule, contact.listIds);
  if (field.startsWith("custom:")) return evaluateCustom(rule, contact, now);

  if (STRING_FIELDS.has(field)) {
    return evaluateString(rule, readString(contact, field));
  }
  if (DATE_FIELDS.has(field)) {
    return evaluateDate(rule, readDate(contact, field), now);
  }
  if (ENUM_FIELDS.has(field)) {
    return evaluateEnum(rule, contact.status);
  }
  if (ID_FIELDS.has(field)) {
    return evaluateId(rule, contact.ownerUserId);
  }

  throw new SegmentCompileError(`Unknown segment field "${field}"`);
}

function readString(contact: ContactSnapshot, field: string): string | null {
  return (contact as unknown as Record<string, string | null>)[field] ?? null;
}

function readDate(contact: ContactSnapshot, field: string): Date | null {
  return (contact as unknown as Record<string, Date | null>)[field] ?? null;
}

// --- text ------------------------------------------------------------------

function evaluateString(rule: SegmentRule, actual: string | null): boolean {
  const { operator } = rule;

  if (operator === "is_set") return actual !== null && actual !== "";
  if (operator === "is_not_set") return actual === null || actual === "";

  if (operator === "in" || operator === "not_in") {
    const values = requireStringArray(rule).map((value) => value.toLowerCase());
    const hit = actual !== null && values.includes(actual.toLowerCase());
    return operator === "in" ? hit : !hit;
  }

  const value = requireString(rule).toLowerCase();
  // A null column can never satisfy a positive comparison; the negated forms
  // are true for null, which is what compile.ts's NOT wrapper produces.
  const haystack = actual?.toLowerCase() ?? null;

  switch (operator) {
    case "equals":
      return haystack === value;
    case "not_equals":
      return haystack !== value;
    case "contains":
      return haystack !== null && haystack.includes(value);
    case "not_contains":
      return haystack === null || !haystack.includes(value);
    case "starts_with":
      return haystack !== null && haystack.startsWith(value);
    case "ends_with":
      return haystack !== null && haystack.endsWith(value);
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for text field "${rule.field}"`,
      );
  }
}

// --- dates -----------------------------------------------------------------

function evaluateDate(
  rule: SegmentRule,
  actual: Date | null,
  now: Date,
): boolean {
  const { operator } = rule;

  if (operator === "is_set") return actual !== null;
  if (operator === "is_not_set") return actual === null;

  if (actual === null) return false;

  if (operator === "within_days" || operator === "more_than_days_ago") {
    const days = requireNumber(rule);
    const threshold = now.getTime() - days * 86_400_000;
    return operator === "within_days"
      ? actual.getTime() >= threshold
      : actual.getTime() < threshold;
  }

  const at = parseDate(rule);

  switch (operator) {
    case "before":
    case "lt":
      return actual.getTime() < at.getTime();
    case "after":
    case "gt":
      return actual.getTime() > at.getTime();
    case "gte":
      return actual.getTime() >= at.getTime();
    case "lte":
      return actual.getTime() <= at.getTime();
    case "equals": {
      // Whole-UTC-day match, matching compile.ts.
      const start = Date.UTC(
        at.getUTCFullYear(),
        at.getUTCMonth(),
        at.getUTCDate(),
      );
      return (
        actual.getTime() >= start && actual.getTime() < start + 86_400_000
      );
    }
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for date field "${rule.field}"`,
      );
  }
}

// --- enum / id -------------------------------------------------------------

function evaluateEnum(rule: SegmentRule, actual: string): boolean {
  const { operator } = rule;

  if (operator === "in" || operator === "not_in") {
    const values = requireStringArray(rule);
    const hit = values.includes(actual);
    return operator === "in" ? hit : !hit;
  }

  const value = requireString(rule);
  switch (operator) {
    case "equals":
      return actual === value;
    case "not_equals":
      return actual !== value;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for field "${rule.field}"`,
      );
  }
}

function evaluateId(rule: SegmentRule, actual: string | null): boolean {
  const { operator } = rule;

  switch (operator) {
    case "is_set":
      return actual !== null;
    case "is_not_set":
      return actual === null;
    case "equals":
      return actual === requireString(rule);
    case "not_equals":
      return actual !== requireString(rule);
    case "in":
      return actual !== null && requireStringArray(rule).includes(actual);
    case "not_in":
      return actual === null || !requireStringArray(rule).includes(actual);
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for field "${rule.field}"`,
      );
  }
}

// --- membership ------------------------------------------------------------

function evaluateMembership(rule: SegmentRule, owned: string[]): boolean {
  const { operator } = rule;

  if (operator === "is_set") return owned.length > 0;
  if (operator === "is_not_set") return owned.length === 0;

  const ids =
    operator === "equals" || operator === "not_equals"
      ? [requireString(rule)]
      : requireStringArray(rule);

  const hit = ids.some((id) => owned.includes(id));

  switch (operator) {
    case "in":
    case "equals":
      return hit;
    case "not_in":
    case "not_equals":
      return !hit;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for membership`,
      );
  }
}

// --- custom fields ---------------------------------------------------------

function evaluateCustom(
  rule: SegmentRule,
  contact: ContactSnapshot,
  now: Date,
): boolean {
  const key = rule.field.slice("custom:".length);
  if (!key) {
    throw new SegmentCompileError("Custom field rule is missing a key");
  }

  const raw = contact.customFields[key];
  const isUnset = raw === undefined || raw === null;
  const { operator } = rule;

  if (operator === "is_set") return !isUnset;
  if (operator === "is_not_set") return isUnset;

  // compile.ts wraps negation in NOT { some }, so a missing value matches the
  // negated forms.
  if (operator === "not_equals" || operator === "not_contains") {
    if (isUnset) return true;
    return operator === "not_equals"
      ? String(raw) !== String(requireScalar(rule))
      : !String(raw).includes(requireString(rule));
  }

  if (isUnset) return false;

  switch (operator) {
    case "equals":
      return String(raw) === String(requireScalar(rule));
    case "contains":
      return String(raw).includes(requireString(rule));
    case "starts_with":
      return String(raw).startsWith(requireString(rule));
    case "ends_with":
      return String(raw).endsWith(requireString(rule));
    case "gt":
      return Number(raw) > requireNumber(rule);
    case "gte":
      return Number(raw) >= requireNumber(rule);
    case "lt":
      return Number(raw) < requireNumber(rule);
    case "lte":
      return Number(raw) <= requireNumber(rule);
    case "before":
      return new Date(String(raw)).getTime() < parseDate(rule).getTime();
    case "after":
      return new Date(String(raw)).getTime() > parseDate(rule).getTime();
    case "within_days":
      return (
        new Date(String(raw)).getTime() >=
        now.getTime() - requireNumber(rule) * 86_400_000
      );
    case "more_than_days_ago":
      return (
        new Date(String(raw)).getTime() <
        now.getTime() - requireNumber(rule) * 86_400_000
      );
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for a custom field`,
      );
  }
}

// --- value coercion (mirrors compile.ts) -----------------------------------

function requireString(rule: SegmentRule): string {
  const { value } = rule;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new SegmentCompileError(
    `Rule on "${rule.field}" with operator "${rule.operator}" needs a text value`,
  );
}

function requireScalar(rule: SegmentRule): string | number | boolean {
  const { value } = rule;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new SegmentCompileError(
    `Rule on "${rule.field}" needs a text, number, or boolean value`,
  );
}

function requireNumber(rule: SegmentRule): number {
  const { value } = rule;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new SegmentCompileError(
      `Rule on "${rule.field}" with operator "${rule.operator}" needs a numeric value`,
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new SegmentCompileError(
      `Rule on "${rule.field}" has a non-numeric value "${String(value)}"`,
    );
  }
  return parsed;
}

function requireStringArray(rule: SegmentRule): string[] {
  const { value } = rule;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new SegmentCompileError(
        `Rule on "${rule.field}" with operator "${rule.operator}" needs at least one value`,
      );
    }
    return value.map(String);
  }
  if (typeof value === "string" && value.length > 0) return [value];
  throw new SegmentCompileError(
    `Rule on "${rule.field}" with operator "${rule.operator}" needs a list of values`,
  );
}

function parseDate(rule: SegmentRule): Date {
  const { value } = rule;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new SegmentCompileError(
      `Rule on "${rule.field}" with operator "${rule.operator}" needs a date value`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SegmentCompileError(
      `Rule on "${rule.field}" has an invalid date "${String(value)}"`,
    );
  }
  return parsed;
}
