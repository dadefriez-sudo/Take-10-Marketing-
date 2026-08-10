import Link from "next/link";
import { Inbox as InboxIcon } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { getConversation, listConversations } from "@/lib/repos/inbox";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { fullName, relativeTime } from "@/lib/utils";
import { ConversationThread } from "./conversation-thread";

export const metadata = { title: "Inbox" };

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ c?: string; show?: string }>;
}) {
  const { workspace } = await params;
  const { c, show } = await searchParams;
  const ctx = await requireTenant(workspace);

  const conversations = await listConversations(ctx, {
    status: show === "closed" ? "CLOSED" : "OPEN",
  });

  const selected = c ? await getConversation(ctx, c) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Every conversation with a contact, in one thread per channel. Phase 5 fills this with missed-call text-back replies."
      />

      <div className="flex gap-2 text-sm">
        <Link
          href={`/w/${workspace}/inbox`}
          className={show !== "closed" ? "font-medium" : "text-muted-foreground hover:underline"}
        >
          Open
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          href={`/w/${workspace}/inbox?show=closed`}
          className={show === "closed" ? "font-medium" : "text-muted-foreground hover:underline"}
        >
          Closed
        </Link>
      </div>

      {conversations.length === 0 ? (
        <Card>
          <EmptyState
            icon={InboxIcon}
            title="Nothing here yet"
            description="Replies to your emails and texts land here. Send something from an automation or campaign to get started."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="divide-border max-h-[70vh] divide-y overflow-y-auto">
            {conversations.map((conversation) => {
              const last = conversation.messages[0];
              const active = conversation.id === selected?.id;

              return (
                <Link
                  key={conversation.id}
                  href={`/w/${workspace}/inbox?c=${conversation.id}${
                    show === "closed" ? "&show=closed" : ""
                  }`}
                  className={`block px-4 py-3 transition-colors ${
                    active ? "bg-accent" : "hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {fullName(conversation.contact)}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline">{conversation.channel}</Badge>
                      {conversation.unreadCount > 0 ? (
                        <Badge>{conversation.unreadCount}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {last
                      ? `${last.direction === "INBOUND" ? "" : "You: "}${last.body}`
                      : "No messages"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {relativeTime(conversation.lastMessageAt)}
                  </p>
                </Link>
              );
            })}
          </Card>

          {selected ? (
            <ConversationThread
              workspace={workspace}
              conversation={{
                id: selected.id,
                channel: selected.channel,
                status: selected.status,
                contactId: selected.contactId,
                contactName: fullName(selected.contact),
                contactHandle:
                  selected.channel === "EMAIL"
                    ? (selected.contact.email ?? "")
                    : (selected.contact.phone ?? ""),
                messages: selected.messages.map((message) => ({
                  id: message.id,
                  direction: message.direction,
                  status: message.status,
                  subject: message.subject,
                  body: message.body,
                  createdAt: message.createdAt.toISOString(),
                  suppressedReason: message.suppressedReason,
                })),
              }}
            />
          ) : (
            <Card>
              <EmptyState
                icon={InboxIcon}
                title="Pick a conversation"
                description="Choose someone on the left to read the thread and reply."
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
