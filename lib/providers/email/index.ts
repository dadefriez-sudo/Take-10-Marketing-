import { db } from "@/lib/db";
import type { EmailProvider, OutboundEmail, SendResult } from "./types";

export type { EmailProvider, OutboundEmail, SendResult } from "./types";

const DEFAULT_FROM =
  process.env.EMAIL_FROM ?? "Take 10 Marketing <hello@example.com>";

/**
 * Captures mail in the database instead of sending it. This is the default
 * until a real provider key exists, which is what lets the whole product be
 * demoed before any domain or sending reputation is in place — read it at
 * /dev/inbox.
 */
class DevInboxProvider implements EmailProvider {
  readonly name = "dev-inbox";

  async send(email: OutboundEmail): Promise<SendResult> {
    const row = await db.devInbox.create({
      data: {
        to: email.to,
        from: email.from ?? DEFAULT_FROM,
        subject: email.subject,
        body: email.html,
        channel: "email",
        metadata: (email.metadata ?? {}) as object,
      },
      select: { id: true },
    });

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[dev-inbox] "${email.subject}" -> ${email.to} (view at /dev/inbox)`,
      );
    }

    return { id: row.id, provider: this.name, delivered: false };
  }
}

let cached: EmailProvider | undefined;

/**
 * Resolve the active transport. Phase 2 adds Resend/Postmark implementations
 * here, keyed off the workspace's own configuration with these env vars as the
 * org-wide fallback.
 */
export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  // No live credentials yet — every phase that sends mail degrades to capture
  // rather than failing, so a missing key is never a broken feature.
  cached = new DevInboxProvider();
  return cached;
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  return getEmailProvider().send({ ...email, from: email.from ?? DEFAULT_FROM });
}
