import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { automationStats, getAutomation } from "@/lib/repos/automations";
import { listTags } from "@/lib/repos/crm";
import { listContacts } from "@/lib/repos/contacts";
import { parseGraph } from "@/lib/automation/graph";
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  StatTile,
} from "@/components/ui";
import { fullName, relativeTime } from "@/lib/utils";
import { AutomationEditor } from "./automation-editor";

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; automationId: string }>;
}) {
  const { workspace, automationId } = await params;
  const ctx = await requireTenant(workspace);

  const automation = await getAutomation(ctx, automationId);
  if (!automation) notFound();

  const [stats, tags, contacts] = await Promise.all([
    automationStats(ctx, automationId),
    listTags(ctx),
    listContacts(ctx, { pageSize: 50, sort: "recent" }),
  ]);

  const latest = automation.versions[0];
  const graph = latest ? parseGraph(latest.graph) : null;

  return (
    <div className="space-y-6">
      <Link
        href={`/w/${workspace}/automations`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> All automations
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {automation.name}
            <Badge
              variant={
                automation.status === "ACTIVE"
                  ? "success"
                  : automation.status === "PAUSED"
                    ? "warning"
                    : "outline"
              }
            >
              {automation.status}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">
            Draft v{latest?.version ?? 1}
            {latest?.publishedAt ? " · published" : " · unpublished changes"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="In flight"
          value={
            (stats.byStatus.RUNNING ?? 0) + (stats.byStatus.WAITING ?? 0)
          }
        />
        <StatTile label="Completed" value={stats.byStatus.COMPLETED ?? 0} />
        <StatTile label="Exited" value={stats.byStatus.EXITED ?? 0} />
        <StatTile label="Messages sent" value={stats.messagesSent} />
      </div>

      {graph ? (
        <AutomationEditor
          workspace={workspace}
          automationId={automationId}
          status={automation.status}
          initialGraph={graph}
          tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          contacts={contacts.items.map((contact) => ({
            id: contact.id,
            name: fullName(contact),
          }))}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {automation.runs.length === 0 ? (
            <p className="text-muted-foreground px-5 pb-5 text-sm">
              Nobody has entered this automation yet.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {automation.runs.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/w/${workspace}/contacts/${run.contactId}`}
                      className="truncate font-medium hover:underline"
                    >
                      {fullName(run.contact)}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {run.currentNodeId
                        ? `at "${run.currentNodeId}"`
                        : "finished"}
                      {run.lastError ? ` · ${run.lastError}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        run.status === "FAILED"
                          ? "destructive"
                          : run.status === "COMPLETED"
                            ? "success"
                            : "outline"
                      }
                    >
                      {run.status}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {relativeTime(run.startedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
