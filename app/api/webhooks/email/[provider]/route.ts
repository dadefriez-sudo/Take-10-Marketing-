import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suppress } from "@/lib/messaging/send";
import type { MessageEventType } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * Delivery events from the email provider.
 *
 * Bounces and complaints are the ones that matter: a hard bounce or a spam
 * complaint must land on the suppression list immediately, because continuing
 * to mail either is how a sending domain's reputation dies.
 *
 * Provider payload shapes differ, so each is normalized to a common event
 * before anything is written.
 */

interface NormalizedEvent {
  providerMessageId?: string;
  messageId?: string;
  email?: string;
  type: MessageEventType;
  url?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const secretHeader = request.headers.get("x-webhook-secret");
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  if (expected && secretHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const events = normalize(provider, payload);
  if (events.length === 0) {
    // Accept unknown shapes so the provider stops retrying; nothing to do.
    return NextResponse.json({ ok: true, handled: 0 });
  }

  let handled = 0;

  for (const event of events) {
    const message = await db.message.findFirst({
      where: event.messageId
        ? { id: event.messageId }
        : { providerMessageId: event.providerMessageId },
      select: { id: true, workspaceId: true, toAddress: true, contactId: true },
    });
    if (!message) continue;

    await db.messageEvent.create({
      data: { messageId: message.id, type: event.type, url: event.url },
    });

    if (event.type === "BOUNCED" || event.type === "COMPLAINED") {
      await db.message.update({
        where: { id: message.id },
        data: { status: "BOUNCED" },
      });

      await suppress(
        message.workspaceId,
        "EMAIL",
        message.toAddress,
        event.type === "BOUNCED" ? "BOUNCE" : "COMPLAINT",
        `Reported by ${provider}`,
      );

      if (message.contactId) {
        await db.activity.create({
          data: {
            workspaceId: message.workspaceId,
            contactId: message.contactId,
            type: "SYSTEM",
            title:
              event.type === "BOUNCED"
                ? "Email bounced — address suppressed"
                : "Marked as spam — address suppressed",
          },
        });
      }
    } else if (event.type === "DELIVERED") {
      await db.message.updateMany({
        where: { id: message.id, status: "SENT" },
        data: { status: "DELIVERED" },
      });
    }

    handled += 1;
  }

  return NextResponse.json({ ok: true, handled });
}

const TYPE_MAP: Record<string, MessageEventType> = {
  delivered: "DELIVERED",
  delivery: "DELIVERED",
  open: "OPENED",
  opened: "OPENED",
  click: "CLICKED",
  clicked: "CLICKED",
  bounce: "BOUNCED",
  bounced: "BOUNCED",
  hard_bounce: "BOUNCED",
  complaint: "COMPLAINED",
  complained: "COMPLAINED",
  spamcomplaint: "COMPLAINED",
  failed: "FAILED",
  unsubscribe: "UNSUBSCRIBED",
};

function normalize(provider: string, payload: unknown): NormalizedEvent[] {
  const rows = Array.isArray(payload) ? payload : [payload];
  const events: NormalizedEvent[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;

    // Resend nests the payload under `data`; Postmark is flat.
    const data =
      (record.data as Record<string, unknown> | undefined) ?? record;

    const rawType = String(
      record.type ?? record.event ?? record.RecordType ?? "",
    )
      .toLowerCase()
      .replace(/^email\./, "")
      .replace(/[^a-z_]/g, "");

    const type = TYPE_MAP[rawType];
    if (!type) continue;

    events.push({
      type,
      messageId:
        (data.tags as Record<string, string> | undefined)?.messageId ??
        (record.messageId as string | undefined),
      providerMessageId:
        (data.email_id as string | undefined) ??
        (data.id as string | undefined) ??
        (record.MessageID as string | undefined),
      email:
        (data.to as string | undefined) ??
        (record.Recipient as string | undefined),
      url: (data.url as string | undefined) ?? (record.Link as string | undefined),
    });
  }

  return events;
}
