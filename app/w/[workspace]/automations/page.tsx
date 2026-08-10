import Link from "next/link";
import { Workflow } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { listAutomations } from "@/lib/repos/automations";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { relativeTime } from "@/lib/utils";
import { NewAutomationForm } from "./new-automation-form";

export const metadata = { title: "Automations" };

const STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "success" | "warning"
> = {
  DRAFT: "outline",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "outline",
};

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);
  const automations = await listAutomations(ctx);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Sequences that run themselves. Edits create a new draft — contacts already partway through keep running the version they started on."
      />

      <NewAutomationForm workspace={workspace} />

      {automations.length === 0 ? (
        <Card>
          <EmptyState
            icon={Workflow}
            title="No automations yet"
            description="Create one to send a welcome sequence, a follow-up, or a win-back."
          />
        </Card>
      ) : (
        <Card className="divide-border divide-y overflow-hidden">
          {automations.map((automation) => (
            <Link
              key={automation.id}
              href={`/w/${workspace}/automations/${automation.id}`}
              className="hover:bg-muted/40 flex items-center justify-between gap-4 px-5 py-4 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{automation.name}</p>
                  <Badge variant={STATUS_VARIANT[automation.status] ?? "outline"}>
                    {automation.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {automation.activeRuns} in flight · {automation._count.runs}{" "}
                  total · updated {relativeTime(automation.updatedAt)}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs">
                v{automation.versions[0]?.version ?? 1}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
