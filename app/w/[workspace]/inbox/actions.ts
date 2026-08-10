"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/tenant";
import { getConversation, markRead, setConversationStatus } from "@/lib/repos/inbox";
import { sendMessage } from "@/lib/messaging/send";

export interface InboxState {
  error?: string;
  success?: string;
}

export async function replyAction(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const workspace = String(formData.get("workspace") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { error: "Write something first" };

  const ctx = await requirePermission(workspace, "contact:write");
  const conversation = await getConversation(ctx, conversationId);
  if (!conversation) return { error: "That conversation no longer exists" };

  const outcome = await sendMessage({
    workspaceId: ctx.workspaceId,
    contactId: conversation.contactId,
    channel: conversation.channel,
    subject: conversation.channel === "EMAIL" ? "Re: your message" : undefined,
    body,
    // A human replying to an inbound message is a direct response, so quiet
    // hours must not hold it — but suppression still applies.
    transactional: true,
  });

  revalidatePath(`/w/${workspace}/inbox`);

  switch (outcome.status) {
    case "sent":
      return { success: "Sent" };
    case "suppressed":
      return { error: `Not sent — ${outcome.reason}` };
    case "deferred":
      return { success: "Queued for the next permitted sending window" };
    default:
      return { error: outcome.reason };
  }
}

export async function markReadAction(
  workspace: string,
  conversationId: string,
): Promise<InboxState> {
  const ctx = await requirePermission(workspace, "contact:read");
  await markRead(ctx, conversationId);
  revalidatePath(`/w/${workspace}/inbox`);
  return {};
}

export async function setStatusAction(
  workspace: string,
  conversationId: string,
  status: "OPEN" | "CLOSED",
): Promise<InboxState> {
  const ctx = await requirePermission(workspace, "contact:write");
  const ok = await setConversationStatus(ctx, conversationId, status);
  if (!ok) return { error: "That conversation no longer exists" };

  revalidatePath(`/w/${workspace}/inbox`);
  return { success: status === "CLOSED" ? "Closed" : "Reopened" };
}
