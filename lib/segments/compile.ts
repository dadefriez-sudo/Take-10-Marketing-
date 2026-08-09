import { Prisma } from "@/generated/prisma/client";
import {
  CONTACT_DATE_FIELDS,
  CONTACT_ENUM_FIELDS,
  CONTACT_ID_FIELDS,
  CONTACT_STRING_FIELDS,
  SegmentCompileError,
  isGroup,
  type ContactDateField,
  type ContactEnumField,
  type ContactIdField,
  type ContactStringField,
  type SegmentGroup,
  type SegmentNode,
  type SegmentRule,
} from "./types";

export interface CompileOptions {
  /**
   * Reference instant for relative operators (`within_days`,
   * `more_than_days_ago`). Injected so tests are deterministic.
   */
  now?: Date;
}

type Where = Prisma.ContactWhereInput;

const STRING_FIELDS = new Set<string>(CONTACT_STRING_FIELDS);
const DATE_FIELDS = new Set<string>(CONTACT_DATE_FIELDS);
const ENUM_FIELDS = new Set<string>(CONTACT_ENUM_FIELDS);
const ID_FIELDS = new Set<string>(CONTACT_ID_FIELDS);

const VALID_STATUSES = new Set([
  "LEAD",
  "ACTIVE",
  "CUSTOMER",
  "UNSUBSCRIBED",
  "ARCHIVED",
]);

/**
 * Compile a segment predicate tree into a Prisma `where` fragment.
 *
 * Returns a fragment only — the caller is responsible for AND-ing in the
 * workspace scope. `compileSegmentForWorkspace` does that and is what callers
 * should normally use.
 *
 * Compiling to a Prisma where object rather than raw SQL keeps user-authored
 * filter values parameterized; no segment value is ever interpolated into SQL.
 */
export function compileSegment(
  node: SegmentNode,
  options: CompileOptions = {},
): Where {
  const now = options.now ?? new Date();
  return compileNode(node, now);
}

/** The normal entry point: a segment AND-ed with its workspace scope. */
export function compileSegmentForWorkspace(
  workspaceId: string,
  node: SegmentNode | null | undefined,
  options: CompileOptions = {},
): Where {
  if (!node) return { workspaceId };
  const compiled = compileSegment(node, options);
  if (Object.keys(compiled).length === 0) return { workspaceId };
  return { AND: [{ workspaceId }, compiled] };
}

function compileNode(node: SegmentNode, now: Date): Where {
  if (isGroup(node)) return compileGroup(node, now);
  return compileRule(node, now);
}

function compileGroup(group: SegmentGroup, now: Date): Where {
  if (group.combinator !== "AND" && group.combinator !== "OR") {
    throw new SegmentCompileError(
      `Unknown combinator "${String(group.combinator)}"`,
    );
  }

  const compiled = group.rules
    .map((rule) => compileNode(rule, now))
    .filter((where) => Object.keys(where).length > 0);

  // An empty group matches everything rather than nothing: a filter builder
  // with no rules yet should show the full list, not an empty one.
  if (compiled.length === 0) return {};
  if (compiled.length === 1) return compiled[0]!;

  return group.combinator === "AND" ? { AND: compiled } : { OR: compiled };
}

function compileRule(rule: SegmentRule, now: Date): Where {
  const { field } = rule;

  if (field === "tag") return compileMembership(rule, "tag");
  if (field === "list") return compileMembership(rule, "list");
  if (field.startsWith("custom:")) return compileCustom(rule, now);

  if (STRING_FIELDS.has(field)) {
    return compileString(rule, field as ContactStringField);
  }
  if (DATE_FIELDS.has(field)) {
    return compileDate(rule, field as ContactDateField, now);
  }
  if (ENUM_FIELDS.has(field)) {
    return compileEnum(rule, field as ContactEnumField);
  }
  if (ID_FIELDS.has(field)) {
    return compileId(rule, field as ContactIdField);
  }

  throw new SegmentCompileError(`Unknown segment field "${field}"`);
}

// --- string columns --------------------------------------------------------

function compileString(rule: SegmentRule, field: ContactStringField): Where {
  const { operator } = rule;

  if (operator === "is_set") {
    return { [field]: { not: null } } as Where;
  }
  if (operator === "is_not_set") {
    return { [field]: null } as Where;
  }

  if (operator === "in" || operator === "not_in") {
    const values = requireStringArray(rule);
    return (
      operator === "in"
        ? { [field]: { in: values } }
        : { NOT: { [field]: { in: values } } }
    ) as Where;
  }

  const value = requireString(rule);
  const insensitive = { mode: "insensitive" as const };

  switch (operator) {
    case "equals":
      return { [field]: { equals: value, ...insensitive } } as Where;
    case "not_equals":
      return {
        NOT: { [field]: { equals: value, ...insensitive } },
      } as Where;
    case "contains":
      return { [field]: { contains: value, ...insensitive } } as Where;
    case "not_contains":
      return {
        NOT: { [field]: { contains: value, ...insensitive } },
      } as Where;
    case "starts_with":
      return { [field]: { startsWith: value, ...insensitive } } as Where;
    case "ends_with":
      return { [field]: { endsWith: value, ...insensitive } } as Where;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for text field "${field}"`,
      );
  }
}

// --- date columns ----------------------------------------------------------

function compileDate(
  rule: SegmentRule,
  field: ContactDateField,
  now: Date,
): Where {
  const { operator } = rule;

  if (operator === "is_set") return { [field]: { not: null } } as Where;
  if (operator === "is_not_set") return { [field]: null } as Where;

  if (operator === "within_days" || operator === "more_than_days_ago") {
    const days = requireNumber(rule);
    const threshold = new Date(now.getTime() - days * 86_400_000);
    return (
      operator === "within_days"
        ? { [field]: { gte: threshold } }
        : { [field]: { lt: threshold } }
    ) as Where;
  }

  const at = parseDate(rule);

  switch (operator) {
    case "before":
    case "lt":
      return { [field]: { lt: at } } as Where;
    case "after":
    case "gt":
      return { [field]: { gt: at } } as Where;
    case "gte":
      return { [field]: { gte: at } } as Where;
    case "lte":
      return { [field]: { lte: at } } as Where;
    case "equals":
      // A calendar-day match: the stored value is an instant, so compare
      // against the whole UTC day rather than an exact timestamp.
      return {
        [field]: {
          gte: startOfUtcDay(at),
          lt: new Date(startOfUtcDay(at).getTime() + 86_400_000),
        },
      } as Where;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for date field "${field}"`,
      );
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// --- enum / id columns -----------------------------------------------------

function compileEnum(rule: SegmentRule, field: ContactEnumField): Where {
  const { operator } = rule;

  if (operator === "in" || operator === "not_in") {
    const values = requireStringArray(rule).map((value) =>
      assertStatus(value),
    );
    return (
      operator === "in"
        ? { [field]: { in: values } }
        : { NOT: { [field]: { in: values } } }
    ) as Where;
  }

  const value = assertStatus(requireString(rule));

  switch (operator) {
    case "equals":
      return { [field]: value } as Where;
    case "not_equals":
      return { NOT: { [field]: value } } as Where;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for field "${field}"`,
      );
  }
}

function assertStatus(value: string): string {
  if (!VALID_STATUSES.has(value)) {
    throw new SegmentCompileError(`Unknown contact status "${value}"`);
  }
  return value;
}

function compileId(rule: SegmentRule, field: ContactIdField): Where {
  const { operator } = rule;

  switch (operator) {
    case "is_set":
      return { [field]: { not: null } } as Where;
    case "is_not_set":
      return { [field]: null } as Where;
    case "equals":
      return { [field]: requireString(rule) } as Where;
    case "not_equals":
      return { NOT: { [field]: requireString(rule) } } as Where;
    case "in":
      return { [field]: { in: requireStringArray(rule) } } as Where;
    case "not_in":
      return { NOT: { [field]: { in: requireStringArray(rule) } } } as Where;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for field "${field}"`,
      );
  }
}

// --- tag / list membership -------------------------------------------------

function compileMembership(rule: SegmentRule, kind: "tag" | "list"): Where {
  const relation = kind === "tag" ? "tags" : "lists";
  const idField = kind === "tag" ? "tagId" : "listId";
  const { operator } = rule;

  if (operator === "is_set") {
    return { [relation]: { some: {} } } as Where;
  }
  if (operator === "is_not_set") {
    return { [relation]: { none: {} } } as Where;
  }

  const ids =
    rule.operator === "equals" || rule.operator === "not_equals"
      ? [requireString(rule)]
      : requireStringArray(rule);

  switch (operator) {
    case "in":
    case "equals":
      return { [relation]: { some: { [idField]: { in: ids } } } } as Where;
    case "not_in":
    case "not_equals":
      return { [relation]: { none: { [idField]: { in: ids } } } } as Where;
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for ${kind} membership`,
      );
  }
}

// --- custom fields ---------------------------------------------------------

function compileCustom(rule: SegmentRule, now: Date): Where {
  const key = rule.field.slice("custom:".length);
  if (!key) {
    throw new SegmentCompileError("Custom field rule is missing a key");
  }

  const { operator } = rule;

  if (operator === "is_not_set") {
    // Either no row at all, or a row holding JSON null.
    return {
      OR: [
        { fieldValues: { none: { field: { key } } } },
        {
          fieldValues: {
            some: { field: { key }, value: { equals: Prisma.AnyNull } },
          },
        },
      ],
    };
  }

  if (operator === "is_set") {
    return {
      fieldValues: {
        some: { field: { key }, NOT: { value: { equals: Prisma.AnyNull } } },
      },
    };
  }

  const valueFilter = customValueFilter(rule, now);

  if (operator === "not_equals" || operator === "not_contains") {
    return {
      NOT: { fieldValues: { some: { field: { key }, value: valueFilter } } },
    };
  }

  return { fieldValues: { some: { field: { key }, value: valueFilter } } };
}

function customValueFilter(
  rule: SegmentRule,
  now: Date,
): Prisma.JsonFilter<"ContactFieldValue"> {
  const { operator } = rule;

  switch (operator) {
    case "equals":
    case "not_equals":
      return { equals: requireJsonScalar(rule) };
    case "contains":
    case "not_contains":
      return { string_contains: requireString(rule) };
    case "starts_with":
      return { string_starts_with: requireString(rule) };
    case "ends_with":
      return { string_ends_with: requireString(rule) };
    case "gt":
      return { gt: requireNumber(rule) };
    case "gte":
      return { gte: requireNumber(rule) };
    case "lt":
      return { lt: requireNumber(rule) };
    case "lte":
      return { lte: requireNumber(rule) };
    case "before":
      return { lt: parseDate(rule).toISOString() };
    case "after":
      return { gt: parseDate(rule).toISOString() };
    case "within_days": {
      const days = requireNumber(rule);
      return { gte: new Date(now.getTime() - days * 86_400_000).toISOString() };
    }
    case "more_than_days_ago": {
      const days = requireNumber(rule);
      return { lt: new Date(now.getTime() - days * 86_400_000).toISOString() };
    }
    default:
      throw new SegmentCompileError(
        `Operator "${operator}" is not valid for a custom field`,
      );
  }
}

// --- value coercion --------------------------------------------------------

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

function requireNumber(rule: SegmentRule): number {
  const { value } = rule;
  const parsed = typeof value === "number" ? value : Number(value);
  if (typeof value !== "number" && typeof value !== "string") {
    throw new SegmentCompileError(
      `Rule on "${rule.field}" with operator "${rule.operator}" needs a numeric value`,
    );
  }
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

function requireJsonScalar(rule: SegmentRule): string | number | boolean {
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

/** Narrow unknown JSON from the database into a predicate tree. */
export function parseSegmentDefinition(value: unknown): SegmentGroup {
  if (
    value &&
    typeof value === "object" &&
    "combinator" in value &&
    "rules" in value &&
    Array.isArray((value as SegmentGroup).rules)
  ) {
    return value as SegmentGroup;
  }
  throw new SegmentCompileError("Segment definition is malformed");
}
