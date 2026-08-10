"use server";

import { db } from "@/lib/db";
import { suppress, unsubscribeToken } from "@/lib/messaging/send";

export interface UnsubscribeState {
  done?: boolean;
  resubscribed?: boolean;
  error?: string;
}

async function authorize(contactId: string, token: string) {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { id: true, email: true, workspaceId: true },
  });

  if (!contact?.email) return null;
  if (token !== unsubscribeToken(contact.workspaceId, contact.id)) return null;
  return contact;
}

export async function unsubscribeAction(
  _prev: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const contact = await authorize(
    String(formData.get("contactId") ?? ""),
    String(formData.get("token") ?? ""),
  );
  if (!contact) return { error: "That unsubscribe link is not valid." };

  await suppress(
    contact.workspaceId,
    "EMAIL",
    contact.email!,
    "UNSUBSCRIBE",
    "Unsubscribed from an email footer link",
  );

  await db.contact.update({
    where: { id: contact.id },
    data: { status: "UNSUBSCRIBED" },
  });

  await db.activity.create({
    data: {
      workspaceId: contact.workspaceId,
      contactId: contact.id,
      type: "SYSTEM",
      title: "Unsubscribed from email",
    },
  });

  return { done: true };
}

/**
 * Undo, for the person who clicked by mistake. Removing the suppression is the
 * only way back — the contact's own status is not enough, because the send path
 * checks the suppression list first.
 */
export async function resubscribeAction(
  _prev: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const contact = await authorize(
    String(formData.get("contactId") ?? ""),
    String(formData.get("token") ?? ""),
  );
  if (!contact) return { error: "That link is not valid." };

  await db.suppression.deleteMany({
    where: {
      workspaceId: contact.workspaceId,
      channel: "EMAIL",
      address: contact.email!.toLowerCase(),
    },
  });

  await db.contact.update({
    where: { id: contact.id },
    data: { status: "ACTIVE" },
  });

  await db.activity.create({
    data: {
      workspaceId: contact.workspaceId,
      contactId: contact.id,
      type: "SYSTEM",
      title: "Re-subscribed to email",
    },
  });

  return { resubscribed: true };
}
