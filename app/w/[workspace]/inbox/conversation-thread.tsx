"use client";

import Link from "next/link";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { markReadAction, replyAction, setStatusAction } from "./actions";
import { cn, formatDateTime } from "@/lib/utils";

interface ThreadMessage {
  id: string;
  direction: string;
  status: string;
  subject: string | null;
  body: string;
  createdAt: string;
  suppressedReason: string | null;
}

export function ConversationThread({
  workspace,
  conversation,
}: {
  workspace: string;
  conversation: {
    id: string;
    channel: string;
    status: string;
    contactId: string;
    contactName: string;
    contactHandle: string;
    messages: ThreadMessage[];
  };
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const marked = useRef<string | null>(null);

  // Clear the unread badge once the thread is actually on screen.
  useEffect(() => {
    if (marked.current === conversation.id) return;
    marked.current = conversation.id;
    void markReadAction(workspace, conversation.id);
  }, [workspace, conversation.id]);

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  return (
    <Card className="flex max-h-[70vh] flex-col">
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border">
        <div>
          <CardTitle>
            <Link
              href={`/w/${workspace}/contacts/${conversation.contactId}`}
              className="hover:underline"
            >
              {conversation.contactName}
            </Link>
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            {conversation.contactHandle} · {conversation.channel}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(() =>
              setStatusAction(
                workspace,
                conversation.id,
                conversation.status === "OPEN" ? "CLOSED" : "OPEN",
              ),
            )
          }
        >
          {conversation.status === "OPEN" ? "Close" : "Reopen"}
        </Button>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 overflow-y-auto py-4">
        {conversation.messages.map((message) => {
          const inbound = message.direction === "INBOUND";
          return (
            <div
              key={message.id}
              className={cn("flex", inbound ? "justify-start" : "justify-end")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  inbound
                    ? "bg-muted"
                    : message.status === "SUPPRESSED"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary text-primary-foreground",
                )}
              >
                {message.subject ? (
                  <p className="mb-1 text-xs font-semibold opacity-80">
                    {message.subject}
                  </p>
                ) : null}
                <div
                  className="[&_a]:underline"
                  // Bodies are produced by this app's own templates and by
                  // inbound provider payloads that the sender escapes.
                  dangerouslySetInnerHTML={{ __html: message.body }}
                />
                <p className="mt-1 text-[10px] opacity-70">
                  {formatDateTime(message.createdAt)}
                  {message.status === "SUPPRESSED"
                    ? ` · blocked: ${message.suppressedReason}`
                    : ""}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>

      <div className="border-t border-border p-3">
        {conversation.contactHandle ? (
          <form
            ref={formRef}
            action={(formData) => {
              startTransition(async () => {
                const result = await replyAction({}, formData);
                if (result.error) toast.error(result.error);
                else {
                  toast.success(result.success ?? "Sent");
                  formRef.current?.reset();
                }
                router.refresh();
              });
            }}
            className="space-y-2"
          >
            <input type="hidden" name="workspace" value={workspace} />
            <input
              type="hidden"
              name="conversationId"
              value={conversation.id}
            />
            <Textarea
              name="body"
              rows={3}
              required
              placeholder={`Reply by ${conversation.channel.toLowerCase()}…`}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            <Badge variant="warning">No {conversation.channel.toLowerCase()} address</Badge>{" "}
            This contact can&apos;t be replied to on this channel.
          </p>
        )}
      </div>
    </Card>
  );
}
