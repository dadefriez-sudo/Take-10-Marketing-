import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isHelpKeyword,
  isOptInKeyword,
  isOptOutKeyword,
} from "@/lib/messaging/guard";
import { suppress, upsertConversation } from "@/lib/messaging/send";
import { sendSms } from "@/lib/providers/sms";
import { fireTrigger } from "@/lib/automation/run";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Inbound SMS.
 *
 * Two jobs: thread the message into the unified inbox, and honor STOP. Carriers
 * require opt-out to work immediately and unconditionally, so the suppression
 * is written before anything else happens — no automation, no reply, no
 * conditions.
 *
 * Shaped for Twilio's form-encoded webhook but tolerant of JSON, so the dev
 * console and a real provider hit the same path.
 */
export async function POST(request: Request) {
  const payload = await readPayload(request);

  const from = normalizePhone(payload.From ?? payload.from);
  const to = payload.To ?? payload.to ?? "";
  const body = (payload.Body ?? payload.body ?? "").toString();

  if (!from) {
    return NextResponse.json(
      { error: "Missing or unparseable From number" },
      { status: 400 },
    );
  }

  // Route by the number that was messaged once Phase 5 provisions per-client
  // numbers; until then, match the contact on their phone.
  const contact = await db.contact.findFirst({
    where: { phone: from },
    select: { id: true, workspaceId: true },
    orderBy: { createdAt: "desc" },
  });

  if (!contact) {
    // Nothing to attach it to yet. Accept rather than error so the provider
    // does not retry forever.
    return NextResponse.json({ ok: true, matched: false });
  }

  const now = new Date();
  const conversation = await upsertConversation(
    contact.workspaceId,
    contact.id,
    "SMS",
    now,
  );

  await db.message.create({
    data: {
      workspaceId: contact.workspaceId,
      contactId: contact.id,
      conversationId: conversation.id,
      channel: "SMS",
      direction: "INBOUND",
      status: "DELIVERED",
      toAddress: String(to),
      fromAddress: from,
      body,
      sentAt: now,
    },
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: { unreadCount: { increment: 1 }, lastMessageAt: now },
  });

  await db.activity.create({
    data: {
      workspaceId: contact.workspaceId,
      contactId: contact.id,
      type: "SMS",
      title: "Inbound SMS",
      body,
    },
  });

  await db.contact.update({
    where: { id: contact.id },
    data: { lastActivityAt: now },
  });

  if (isOptOutKeyword(body)) {
    await suppress(
      contact.workspaceId,
      "SMS",
      from,
      "SMS_STOP",
      "Replied STOP",
    );
    await db.contact.update({
      where: { id: contact.id },
      data: { status: "UNSUBSCRIBED" },
    });
    await db.consentRecord.create({
      data: {
        workspaceId: contact.workspaceId,
        contactId: contact.id,
        channel: "SMS",
        granted: false,
        source: "sms-stop",
        text: body,
      },
    });

    return NextResponse.json({ ok: true, action: "opted_out" });
  }

  if (isOptInKeyword(body)) {
    await db.suppression.deleteMany({
      where: {
        workspaceId: contact.workspaceId,
        channel: "SMS",
        address: from.toLowerCase(),
      },
    });
    await db.consentRecord.create({
      data: {
        workspaceId: contact.workspaceId,
        contactId: contact.id,
        channel: "SMS",
        granted: true,
        source: "sms-start",
        text: body,
      },
    });

    return NextResponse.json({ ok: true, action: "opted_in" });
  }

  if (isHelpKeyword(body)) {
    const workspace = await db.workspace.findUnique({
      where: { id: contact.workspaceId },
      select: { name: true },
    });
    await sendSms({
      to: from,
      body: `${workspace?.name ?? "We"}: reply STOP to unsubscribe. Message and data rates may apply.`,
    });

    return NextResponse.json({ ok: true, action: "help" });
  }

  // A genuine reply — let automations react to it.
  await fireTrigger(contact.workspaceId, "call_missed", contact.id, {
    inboundBody: body,
  }).catch(() => null);

  return NextResponse.json({ ok: true, action: "received" });
}

async function readPayload(
  request: Request,
): Promise<Record<string, string | undefined>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, string>;
  }

  const form = await request.formData();
  return Object.fromEntries(
    [...form.entries()].map(([key, value]) => [key, String(value)]),
  );
}
