import Link from "next/link";
import { Activity as ActivityIcon } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { workspaceSummary } from "@/lib/repos/crm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatTile,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { formatCurrency, fullName, relativeTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);
  const summary = await workspaceSummary(ctx);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ctx.workspace.name}
        description="What's happening with this client right now."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/w/${workspace}/contacts/import`}>Import CSV</Link>
            </Button>
            <Button asChild>
              <Link href={`/w/${workspace}/contacts?new=1`}>Add contact</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Contacts"
          value={summary.contactCount.toLocaleString()}
          hint={`${summary.newContacts} added in the last 30 days`}
        />
        <StatTile
          label="Customers"
          value={summary.customerCount.toLocaleString()}
          hint="Contacts marked as customers"
        />
        <StatTile
          label="Open pipeline"
          value={formatCurrency(summary.openDealValue)}
          hint={`${summary.openDealCount} open deals`}
        />
        <StatTile
          label="Open tasks"
          value={summary.openTasks.toLocaleString()}
          hint="Assigned across the team"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {summary.recentActivity.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="No activity yet"
              description="Add or import contacts and their timeline starts filling in here."
            />
          ) : (
            <ul className="divide-border divide-y">
              {summary.recentActivity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.title}</p>
                    {item.contact ? (
                      <Link
                        href={`/w/${workspace}/contacts/${item.contact.id}`}
                        className="text-muted-foreground hover:text-foreground text-xs hover:underline"
                      >
                        {fullName(item.contact)}
                      </Link>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {relativeTime(item.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
