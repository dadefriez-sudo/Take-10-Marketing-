import { db } from "@/lib/db";

/**
 * SMS transport boundary.
 *
 * The live implementation is Twilio, but US SMS also requires A2P/10DLC brand
 * and campaign registration per client before a single message is deliverable —
 * days to weeks of paperwork. The mock exists so booking reminders, review
 * requests, and missed-call text-back are all buildable and demoable while that
 * registration is pending.
 */

export interface OutboundSms {
  to: string;
  body: string;
  from?: string;
  metadata?: Record<string, unknown>;
}

export interface SmsResult {
  id: string;
  provider: string;
  delivered: boolean;
}

export interface SmsProvider {
  readonly name: string;
  send(message: OutboundSms): Promise<SmsResult>;
}

const DEFAULT_FROM = process.env.SMS_FROM ?? "+15550000000";

class DevInboxSmsProvider implements SmsProvider {
  readonly name = "dev-inbox";

  async send(message: OutboundSms): Promise<SmsResult> {
    const row = await db.devInbox.create({
      data: {
        to: message.to,
        from: message.from ?? DEFAULT_FROM,
        subject: "SMS",
        body: message.body,
        channel: "sms",
        metadata: (message.metadata ?? {}) as object,
      },
      select: { id: true },
    });

    if (process.env.NODE_ENV !== "production") {
      console.info(`[dev-inbox] SMS -> ${message.to}: ${message.body}`);
    }

    return { id: row.id, provider: this.name, delivered: false };
  }
}

let cached: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  // Twilio credentials are not wired yet; capture instead of failing, so a
  // missing key is never a broken feature.
  cached = new DevInboxSmsProvider();
  return cached;
}

export async function sendSms(message: OutboundSms): Promise<SmsResult> {
  return getSmsProvider().send({
    ...message,
    from: message.from ?? DEFAULT_FROM,
  });
}
