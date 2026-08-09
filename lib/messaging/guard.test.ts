import { describe, expect, it } from "vitest";
import {
  QUIET_HOURS,
  appendEmailFooter,
  appendSmsOptOut,
  evaluateSend,
  isHelpKeyword,
  isOptInKeyword,
  isOptOutKeyword,
  isWithinQuietHours,
  localHour,
  nextSendableTime,
  timeZoneOffsetMs,
  zonedPartsToInstant,
  type GuardInput,
} from "./guard";

const CHICAGO = "America/Chicago";
const NY = "America/New_York";

function input(overrides: Partial<GuardInput> = {}): GuardInput {
  return {
    channel: "EMAIL",
    timeZone: CHICAGO,
    // 2pm in Chicago — comfortably inside the window.
    now: new Date("2026-06-15T19:00:00.000Z"),
    isSuppressed: false,
    contactUnsubscribed: false,
    hasSmsConsent: true,
    ...overrides,
  };
}

describe("suppression", () => {
  it("blocks a suppressed recipient", () => {
    expect(evaluateSend(input({ isSuppressed: true }))).toEqual({
      allowed: false,
      outcome: "blocked",
      reason: "Recipient is on the suppression list",
    });
  });

  it("blocks suppressed recipients even for transactional mail", () => {
    // An opt-out outranks everything; "but it's transactional" is how agencies
    // get their clients complaints.
    const decision = evaluateSend(
      input({ isSuppressed: true, transactional: true }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("unsubscribed contacts", () => {
  it("blocks marketing", () => {
    const decision = evaluateSend(input({ contactUnsubscribed: true }));
    expect(decision).toMatchObject({ allowed: false, outcome: "blocked" });
  });

  it("allows transactional", () => {
    const decision = evaluateSend(
      input({ contactUnsubscribed: true, transactional: true }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("SMS consent", () => {
  it("blocks marketing SMS with no recorded consent", () => {
    const decision = evaluateSend(
      input({ channel: "SMS", hasSmsConsent: false }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      outcome: "blocked",
      reason: "No recorded SMS consent for this contact",
    });
  });

  it("allows marketing SMS with consent", () => {
    expect(evaluateSend(input({ channel: "SMS" })).allowed).toBe(true);
  });

  it("allows transactional SMS without marketing consent", () => {
    const decision = evaluateSend(
      input({ channel: "SMS", hasSmsConsent: false, transactional: true }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("does not require consent for email", () => {
    expect(evaluateSend(input({ hasSmsConsent: false })).allowed).toBe(true);
  });
});

describe("quiet hours", () => {
  it("defers rather than dropping a late-night send", () => {
    // 03:00 UTC = 22:00 the previous day in Chicago.
    const decision = evaluateSend(
      input({ now: new Date("2026-06-16T03:00:00.000Z") }),
    );

    expect(decision).toMatchObject({ allowed: false, outcome: "deferred" });
    if (decision.allowed === false && decision.outcome === "deferred") {
      expect(localHour(decision.retryAt, CHICAGO)).toBe(QUIET_HOURS.startHour);
      expect(decision.retryAt.getTime()).toBeGreaterThan(
        new Date("2026-06-16T03:00:00.000Z").getTime(),
      );
    }
  });

  it("defers an early-morning send to later the same morning", () => {
    // 10:00 UTC = 05:00 in Chicago.
    const now = new Date("2026-06-16T10:00:00.000Z");
    const decision = evaluateSend(input({ now }));

    expect(decision).toMatchObject({ outcome: "deferred" });
    if (decision.allowed === false && decision.outcome === "deferred") {
      expect(localHour(decision.retryAt, CHICAGO)).toBe(8);
      // Same local day, only a few hours out.
      expect(decision.retryAt.getTime() - now.getTime()).toBeLessThan(
        4 * 3_600_000,
      );
    }
  });

  it("respects the recipient's zone, not the server's", () => {
    // The same instant falls on opposite sides of the 21:00 cutoff in the two
    // zones: 01:30 UTC is 21:30 in New York (quiet) but 20:30 in Chicago (fine).
    // A single server-local check would get one of these wrong.
    const instant = new Date("2026-06-16T01:30:00.000Z");

    expect(localHour(instant, NY)).toBe(21);
    expect(localHour(instant, CHICAGO)).toBe(20);

    expect(isWithinQuietHours(instant, NY)).toBe(true);
    expect(isWithinQuietHours(instant, CHICAGO)).toBe(false);

    expect(evaluateSend(input({ now: instant, timeZone: NY })).allowed).toBe(
      false,
    );
    expect(
      evaluateSend(input({ now: instant, timeZone: CHICAGO })).allowed,
    ).toBe(true);
  });

  it("can be overridden for an operator-scheduled broadcast", () => {
    const decision = evaluateSend(
      input({
        now: new Date("2026-06-16T03:00:00.000Z"),
        ignoreQuietHours: true,
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("does not apply to transactional messages", () => {
    const decision = evaluateSend(
      input({
        now: new Date("2026-06-16T03:00:00.000Z"),
        transactional: true,
      }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("time zone arithmetic", () => {
  it("computes offsets across a DST boundary", () => {
    // US DST in 2026: starts Mar 8, ends Nov 1.
    const winter = new Date("2026-01-15T12:00:00.000Z");
    const summer = new Date("2026-07-15T12:00:00.000Z");

    expect(timeZoneOffsetMs(winter, CHICAGO)).toBe(-6 * 3_600_000);
    expect(timeZoneOffsetMs(summer, CHICAGO)).toBe(-5 * 3_600_000);
  });

  it("round-trips a wall-clock time back to the same local hour", () => {
    for (const date of [
      "2026-01-15",
      "2026-03-08", // spring forward
      "2026-07-15",
      "2026-11-01", // fall back
      "2026-12-31",
    ]) {
      const [year, month, day] = date.split("-").map(Number);
      const instant = zonedPartsToInstant(
        { year: year!, month: month!, day: day!, hour: 8, minute: 0 },
        CHICAGO,
      );
      expect(localHour(instant, CHICAGO)).toBe(8);
    }
  });

  it("rolls over month and year boundaries when deferring overnight", () => {
    // 23:30 local on Dec 31 must defer to 08:00 on Jan 1 of the next year.
    const newYearsEve = zonedPartsToInstant(
      { year: 2026, month: 12, day: 31, hour: 23, minute: 30 },
      CHICAGO,
    );

    const retry = nextSendableTime(newYearsEve, CHICAGO);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(retry);

    const read = Object.fromEntries(
      parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
    );

    expect(read.year).toBe("2027");
    expect(read.month).toBe("01");
    expect(read.day).toBe("01");
    expect(Number(read.hour)).toBe(8);
  });

  it("lands on a valid instant even across the spring-forward gap", () => {
    // 02:30 does not exist on the spring-forward date in Chicago.
    const instant = zonedPartsToInstant(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      CHICAGO,
    );
    expect(Number.isNaN(instant.getTime())).toBe(false);
    // Whatever it resolves to, it must be a real moment on that day.
    expect(localHour(instant, CHICAGO)).toBeGreaterThanOrEqual(1);
  });
});

describe("inbound keywords", () => {
  it.each(["STOP", "stop", "Stop.", " unsubscribe ", "CANCEL", "quit"])(
    "treats %s as an opt-out",
    (body) => {
      expect(isOptOutKeyword(body)).toBe(true);
    },
  );

  it("does not treat a sentence containing stop as an opt-out", () => {
    // A customer saying "can you stop by at 4" has not opted out.
    expect(isOptOutKeyword("can you stop by at 4")).toBe(false);
    expect(isOptOutKeyword("please stop the reminders")).toBe(false);
  });

  it("recognizes opt-in and help", () => {
    expect(isOptInKeyword("START")).toBe(true);
    expect(isHelpKeyword("help")).toBe(true);
    expect(isHelpKeyword("helping")).toBe(false);
  });
});

describe("message decoration", () => {
  it("appends an address and unsubscribe link to email", () => {
    const html = appendEmailFooter("<p>Hello</p>", {
      businessName: "Bright Smile Dental",
      postalAddress: "12 Main St, Austin TX",
      unsubscribeUrl: "https://example.test/u/abc",
    });

    expect(html).toContain("Bright Smile Dental");
    expect(html).toContain("12 Main St, Austin TX");
    expect(html).toContain("https://example.test/u/abc");
    expect(html).toContain("Unsubscribe");
  });

  it("escapes HTML in the footer", () => {
    const html = appendEmailFooter("<p>Hi</p>", {
      businessName: '<script>alert("x")</script>',
      unsubscribeUrl: "https://example.test/u/abc",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("adds an SMS opt-out line only when one is missing", () => {
    expect(appendSmsOptOut("Your appointment is tomorrow")).toContain(
      "Reply STOP to opt out.",
    );

    const already = "Deals weekly. Reply STOP to unsubscribe.";
    expect(appendSmsOptOut(already)).toBe(already);
  });
});
