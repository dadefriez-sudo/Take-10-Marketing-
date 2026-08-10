import { Send } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { listCampaigns } from "@/lib/repos/campaigns";
import { listSegments } from "@/lib/repos/crm";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CampaignList } from "./campaign-list";
import { CampaignComposer } from "./campaign-composer";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);

  const [campaigns, segments] = await Promise.all([
    listCampaigns(ctx),
    listSegments(ctx),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="One-off broadcasts to a saved segment. Recurring sends belong in an automation instead."
      />

      <CampaignComposer
        workspace={workspace}
        segments={segments.map((segment) => ({
          id: segment.id,
          name: segment.name,
        }))}
      />

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={Send}
            title="No campaigns yet"
            description="Write one above. You'll see the audience size before anything sends."
          />
        </Card>
      ) : (
        <CampaignList
          workspace={workspace}
          campaigns={campaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            subject: campaign.subject ?? "",
            status: campaign.status,
            segmentName: campaign.segment?.name ?? "Everyone",
            createdAt: campaign.createdAt.toISOString(),
            sentAt: campaign.sentAt?.toISOString() ?? null,
            stats: campaign.stats,
          }))}
        />
      )}
    </div>
  );
}
