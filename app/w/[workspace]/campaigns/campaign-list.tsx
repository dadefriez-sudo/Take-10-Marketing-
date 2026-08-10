"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge, Card } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { deleteCampaignAction, sendCampaignAction } from "./actions";
import { relativeTime } from "@/lib/utils";

interface Row {
  id: string;
  name: string;
  subject: string;
  status: string;
  segmentName: string;
  createdAt: string;
  sentAt: string | null;
  stats: Record<string, number>;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "success" | "warning" | "destructive"
> = {
  DRAFT: "outline",
  SCHEDULED: "warning",
  SENDING: "warning",
  SENT: "success",
  CANCELLED: "destructive",
};

export function CampaignList({
  workspace,
  campaigns,
}: {
  workspace: string;
  campaigns: Row[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  return (
    <Card className="divide-border divide-y overflow-hidden">
      {campaigns.map((campaign) => {
        const sent = campaign.stats.SENT ?? 0;
        const suppressed = campaign.stats.SUPPRESSED ?? 0;
        const failed = campaign.stats.FAILED ?? 0;

        return (
          <div
            key={campaign.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{campaign.name}</p>
                <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
                  {campaign.status}
                </Badge>
              </div>
              <p className="text-muted-foreground truncate text-xs">
                {campaign.subject} · to {campaign.segmentName} ·{" "}
                {campaign.sentAt
                  ? `sent ${relativeTime(campaign.sentAt)}`
                  : `created ${relativeTime(campaign.createdAt)}`}
              </p>
              {sent + suppressed + failed > 0 ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {sent} sent
                  {suppressed > 0 ? ` · ${suppressed} suppressed` : ""}
                  {failed > 0 ? ` · ${failed} failed` : ""}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 gap-2">
              {campaign.status === "DRAFT" ? (
                <>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !confirm(
                          `Send "${campaign.name}"? This can't be undone.`,
                        )
                      ) {
                        return;
                      }
                      run(() => sendCampaignAction(workspace, campaign.id));
                    }}
                  >
                    Send
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteCampaignAction(workspace, campaign.id))
                    }
                  >
                    Delete
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
