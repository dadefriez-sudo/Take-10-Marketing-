import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/providers/email";
import { sendSms } from "@/lib/providers/sms";
import { enqueue } from "@/lib/jobs/queue";
import {
  appendEmailFooter,
  appendSmsOptOut,
  evaluateSend,
  type Channel,
} from "./guard";

/**
 * The single outbound path for email and SMS.
 *
 * Everything that sends — campaigns, automations, and from Phase 3 booking
 * reminders — goes through here, so the compliance checks in `guard.ts` cannot
 * be bypassed by a new feature forgetting about them.
 */

export interface SendRequest {
  workspaceId: string;
  contactId: string;
  channel: Channel;
  subject?: string;
  body: string;
  /** Confirmations for something the recipient just did; skips quiet hours. */
  transactional?: boolean;
  ignoreQuietHours?: boolean;
  campaignId?: string | null;
  automationRunId?: string | null;
  now?: Date;
}

export type SendOutcome =
  | { status: "sent"; messageId: string }
  | { status: "suppressed"; messageId: string; reason: string }
  | { status: "deferred"; retryAt: Date; reason: string }
  | { status: "skipped"; reason: string };

export function unsubscribeToken(workspaceId: string, contactId: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return createHash("sha256")
    .update(`${secret}:${workspaceId}:${contactId}`)
    .digest("base64url")
    .slice(0, 32);
}

export async function sendMessage(request: SendRequest): Promise<SendOutcome> {
  const now = request.now ?? new Date();

  const [workspace, contact] = await Promise.all([
    db.workspace.findUnique({
      where: { id: request.workspaceId },
      select: {
        id: true,
        name: true,
        timezone: true,
        addressLine1: true,
        city: true,
        region: true,
        postalCode: true,
        organization: { select: { senderEmail: true, senderName: true } },
      },
    }),
    db.contact.findFirst({
      where: { id: request.contactId, workspaceId: request.workspaceId },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        timezone: true,
      },
    }),
  ]);

  if (!workspace || !contact) {
    return { status: "skipped", reason: "Workspace or contact not found" };
  }

  const address = request.channel === "EMAIL" ? contact.email : contact.phone;
  if (!address) {
    return {
      status: "skipped",
      reason:
        request.channel === "EMAIL"
          ? "Contact has no email address"
          : "Contact has no phone number",
    };
  }

  const [suppression, consent] = await Promise.all([
    db.suppression.findUnique({
      where: {
        workspaceId_channel_address: {
          workspaceId: workspace.id,
          channel: request.channel,
          address: address.toLowerCase(),
        },
      },
      select: { id: true },
    }),
    request.channel === "SMS"
      ? db.consentRecord.findFirst({
          where: {
            workspaceId: workspace.id,
            contactId: contact.id,
            channel: "SMS",
            granted: true,
          },
          orderBy: { occurredAt: "desc" },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const decision = evaluateSend({
    channel: request.channel,
    timeZone: contact.timezone ?? workspace.timezone,
    now,
    isSuppressed: Boolean(suppression),
    contactUnsubscribed: contact.status === "UNSUBSCRIBED",
    hasSmsConsent: Boolean(consent),
    transactional: request.transactional,
    ignoreQuietHours: request.ignoreQuietHours,
  });

  if (decision.allowed === false && decision.outcome === "deferred") {
    // Reschedule rather than drop: the message is still wanted, just not now.
    await enqueue(
      "message.send",
      { ...request, now: undefined } as unknown as Record<string, unknown>,
      { workspaceId: workspace.id, runAt: decision.retryAt },
    );
    return {
      status: "deferred",
      retryAt: decision.retryAt,
      reason: decision.reason,
    };
  }

  const fromAddress =
    request.channel === "EMAIL"
      ? (workspace.organization.senderEmail ??
        process.env.EMAIL_FROM ??
        "hello@example.com")
      : (process.env.SMS_FROM ?? "+15550000000");

  if (decision.allowed === false) {
    // Recorded, not silently dropped — the suppression trail is the evidence
    // that an opt-out was honored.
    const message = await db.message.create({
      data: {
        workspaceId: workspace.id,
        contactId: contact.id,
        campaignId: request.campaignId ?? null,
        automationRunId: request.automationRunId ?? null,
        channel: request.channel,
        direction: "OUTBOUND",
        status: "SUPPRESSED",
        toAddress: address,
        fromAddress,
        subject: request.subject ?? null,
        body: request.body,
        suppressedReason: decision.reason,
      },
      select: { id: true },
    });

    return {
      status: "suppressed",
      messageId: message.id,
      reason: decision.reason,
    };
  }

  const postalAddress = [
    workspace.addressLine1,
    workspace.city,
    workspace.region,
    workspace.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const conversation = await upsertConversation(
    workspace.id,
    contact.id,
    request.channel,
    now,
  );

  const decorated =
    request.channel === "EMAIL"
      ? appendEmailFooter(request.body, {
          businessName: workspace.name,
          postalAddress: postalAddress || null,
          unsubscribeUrl: appUrl(
            `/u/${contact.id}/${unsubscribeToken(workspace.id, contact.id)}`,
          ),
        })
      : appendSmsOptOut(request.body);

  const message = await db.message.create({
    data: {
      workspaceId: workspace.id,
      contactId: contact.id,
      conversationId: conversation.id,
      campaignId: request.campaignId ?? null,
      automationRunId: request.automationRunId ?? null,
      channel: request.channel,
      direction: "OUTBOUND",
      status: "SENDING",
      toAddress: address,
      fromAddress,
      subject: request.subject ?? null,
      body: decorated,
    },
    select: { id: true },
  });

  try {
    const result =
      request.channel === "EMAIL"
        ? await sendEmail({
            to: address,
            subject: request.subject ?? "(no subject)",
            html: decorated,
            from: fromAddress,
            metadata: { messageId: message.id },
          })
        : await sendSms({
            to: address,
            body: decorated,
            from: fromAddress,
            metadata: { messageId: message.id },
          });

    await db.message.update({
      where: { id: message.id },
      data: {
        status: "SENT",
        sentAt: now,
        providerName: result.provider,
        providerMessageId: result.id,
      },
    });

    await db.activity.create({
      data: {
        workspaceId: workspace.id,
        contactId: contact.id,
        type: request.channel === "EMAIL" ? "EMAIL" : "SMS",
        title:
          request.channel === "EMAIL"
            ? `Email sent: ${request.subject ?? "(no subject)"}`
            : "SMS sent",
        body: request.body,
      },
    });

    await db.contact.update({
      where: { id: contact.id },
      data: { lastActivityAt: now },
    });

    return { status: "sent", messageId: message.id };
  } catch (error) {
    await db.message.update({
      where: { id: message.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function upsertConversation(
  workspaceId: string,
  contactId: string,
  channel: Channel,
  now: Date,
) {
  return db.conversation.upsert({
    where: {
      workspaceId_contactId_channel: { workspaceId, contactId, channel },
    },
    update: { lastMessageAt: now },
    create: { workspaceId, contactId, channel, lastMessageAt: now },
    select: { id: true },
  });
}

export async function suppress(
  workspaceId: string,
  channel: Channel,
  address: string,
  reason: "UNSUBSCRIBE" | "BOUNCE" | "COMPLAINT" | "MANUAL" | "SMS_STOP",
  note?: string,
): Promise<void> {
  const normalized = address.toLowerCase();
  await db.suppression.upsert({
    where: {
      workspaceId_channel_address: {
        workspaceId,
        channel,
        address: normalized,
      },
    },
    update: { reason, note },
    create: { workspaceId, channel, address: normalized, reason, note },
  });
}

export function newTrackingToken(): string {
  return randomBytes(16).toString("base64url");
}
