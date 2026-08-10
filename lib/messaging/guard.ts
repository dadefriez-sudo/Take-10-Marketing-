/**
 * The gate every outbound message passes through.
 *
 * This is pure and dependency-free on purpose: the rules here are the ones that
 * keep a client's sending domain and phone number alive, so they must be
 * exhaustively testable without a database. `send.ts` does the I/O and calls
 * `evaluateSend` for the decision.
 *
 * Rules, in order of precedence:
 *   1. Suppression (unsubscribe, bounce, complaint, SMS STOP) blocks everything,
 *      including transactional mail. An opt-out is not negotiable.
 *   2. Marketing to an UNSUBSCRIBED contact is blocked.
 *   3. SMS without a recorded consent is blocked — TCPA requires prior express
 *      consent, and "we have their number" is not consent.
 *   4. Quiet hours defer rather than block: the message is rescheduled to the
 *      next permitted local time instead of being dropped.
 *
 * Transactional messages (an appointment confirmation for a booking the person
 * just made) bypass 2, 3, and 4 — but never 1.
 */

export type Channel = "EMAIL" | "SMS";

/** Local-time window during which marketing may be delivered. */
export const QUIET_HOURS = { startHour: 8, endHour: 21 } as const;

export interface GuardInput {
  channel: Channel;
  /** Recipient's IANA zone; falls back to the workspace's. */
  timeZone: string;
  now: Date;
  isSuppressed: boolean;
  /** Contact-level opt-out, independent of the suppression list. */
  contactUnsubscribed: boolean;
  /** Required before the first marketing SMS. */
  hasSmsConsent: boolean;
  transactional?: boolean;
  /** Skip the quiet-hours check (a broadcast the operator scheduled by hand). */
  ignoreQuietHours?: boolean;
}

export type GuardDecision =
  | { allowed: true }
  | { allowed: false; outcome: "blocked"; reason: string }
  | { allowed: false; outcome: "deferred"; reason: string; retryAt: Date };

export function evaluateSend(input: GuardInput): GuardDecision {
  if (input.isSuppressed) {
    return {
      allowed: false,
      outcome: "blocked",
      reason: "Recipient is on the suppression list",
    };
  }

  const transactional = input.transactional ?? false;

  if (!transactional) {
    if (input.contactUnsubscribed) {
      return {
        allowed: false,
        outcome: "blocked",
        reason: "Contact has unsubscribed",
      };
    }

    if (input.channel === "SMS" && !input.hasSmsConsent) {
      return {
        allowed: false,
        outcome: "blocked",
        reason: "No recorded SMS consent for this contact",
      };
    }

    if (!input.ignoreQuietHours && isWithinQuietHours(input.now, input.timeZone)) {
      return {
        allowed: false,
        outcome: "deferred",
        reason: "Outside permitted sending hours in the recipient's time zone",
        retryAt: nextSendableTime(input.now, input.timeZone),
      };
    }
  }

  return { allowed: true };
}

// --- time zone helpers -----------------------------------------------------

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds.
 *
 * Derived by formatting the instant in the target zone and reading it back as
 * if it were UTC; the difference is the offset. This is DST-correct by
 * construction because the formatter applies whichever rules are in effect on
 * that date.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  // Intl renders midnight as hour 24 in some engines.
  const hour = parts.hour === 24 ? 0 : parts.hour!;

  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    hour,
    parts.minute!,
    parts.second!,
  );

  return asUtc - instant.getTime();
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const shifted = new Date(
    instant.getTime() + timeZoneOffsetMs(instant, timeZone),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Convert a wall-clock time in `timeZone` to the UTC instant it denotes.
 *
 * Two passes: the first offset guess can be wrong when the conversion crosses a
 * DST boundary, so it is recomputed against the candidate instant. For a wall
 * time that does not exist (the spring-forward gap) this lands on the instant
 * just after the jump, which is the useful answer for "send at 8am".
 */
export function zonedPartsToInstant(
  parts: ZonedParts,
  timeZone: string,
): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );

  const firstGuess = new Date(naive - timeZoneOffsetMs(new Date(naive), timeZone));
  const corrected = new Date(
    naive - timeZoneOffsetMs(firstGuess, timeZone),
  );

  return corrected;
}

export function localHour(instant: Date, timeZone: string): number {
  return toZonedParts(instant, timeZone).hour;
}

export function isWithinQuietHours(instant: Date, timeZone: string): boolean {
  const hour = localHour(instant, timeZone);
  return hour < QUIET_HOURS.startHour || hour >= QUIET_HOURS.endHour;
}

/** The next instant at which sending is permitted in the recipient's zone. */
export function nextSendableTime(instant: Date, timeZone: string): Date {
  const parts = toZonedParts(instant, timeZone);

  if (parts.hour < QUIET_HOURS.startHour) {
    // Early morning — wait until the window opens today.
    return zonedPartsToInstant(
      { ...parts, hour: QUIET_HOURS.startHour, minute: 0 },
      timeZone,
    );
  }

  // Evening — the window opens tomorrow morning. Add a day in UTC first, then
  // read the local calendar date back, so month and year roll over correctly.
  const tomorrow = toZonedParts(
    new Date(instant.getTime() + 86_400_000),
    timeZone,
  );

  return zonedPartsToInstant(
    { ...tomorrow, hour: QUIET_HOURS.startHour, minute: 0 },
    timeZone,
  );
}

// --- inbound keyword handling ----------------------------------------------

const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt-out",
]);

const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes", "optin", "opt-in"]);

const HELP_KEYWORDS = new Set(["help", "info"]);

function normalizeKeyword(body: string): string {
  return body.trim().toLowerCase().replace(/[.!?,]+$/g, "");
}

/**
 * Carriers require STOP to work regardless of casing or trailing punctuation.
 * Only a message that is *just* the keyword counts — "please stop by at 4" is a
 * customer talking, not an opt-out.
 */
export function isOptOutKeyword(body: string): boolean {
  return OPT_OUT_KEYWORDS.has(normalizeKeyword(body));
}

export function isOptInKeyword(body: string): boolean {
  return OPT_IN_KEYWORDS.has(normalizeKeyword(body));
}

export function isHelpKeyword(body: string): boolean {
  return HELP_KEYWORDS.has(normalizeKeyword(body));
}

// --- message decoration ----------------------------------------------------

export interface FooterOptions {
  businessName: string;
  postalAddress?: string | null;
  unsubscribeUrl: string;
}

/**
 * CAN-SPAM requires a physical postal address and a working opt-out in every
 * marketing email, so the footer is appended by the sender rather than left to
 * whoever wrote the template.
 */
export function appendEmailFooter(
  html: string,
  options: FooterOptions,
): string {
  const address = options.postalAddress
    ? `<div>${escapeHtml(options.postalAddress)}</div>`
    : "";

  return `${html}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.5">
  <div>${escapeHtml(options.businessName)}</div>
  ${address}
  <div style="margin-top:8px">
    <a href="${options.unsubscribeUrl}" style="color:#64748b">Unsubscribe</a>
  </div>
</div>`;
}

/** Appended once to the first SMS of a conversation, as carriers expect. */
export function appendSmsOptOut(body: string): string {
  if (/\bstop\b/i.test(body)) return body;
  return `${body}\n\nReply STOP to opt out.`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
