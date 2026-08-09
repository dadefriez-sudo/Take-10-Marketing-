import {
  CalendarCheck,
  MessageSquareQuote,
  PhoneCall,
} from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { workspaceSummary } from "@/lib/repos/crm";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatTile,
} from "@/components/ui";
import { fullName, relativeTime } from "@/lib/utils";

export const metadata = { title: "Client portal" };

const UPCOMING = [
  {
    icon: CalendarCheck,
    title: "Online booking",
    body: "Your customers book straight into your calendar, with reminders that cut no-shows.",
    phase: "Phase 3",
  },
  {
    icon: MessageSquareQuote,
    title: "Google reviews",
    body: "Every completed appointment gets the same review request, automatically.",
    phase: "Phase 4",
  },
  {
    icon: PhoneCall,
    title: "After-hours capture",
    body: "Missed calls get an instant text back with a booking link, so the lead doesn't call a competitor.",
    phase: "Phase 5",
  },
];

export default async function PortalPage({
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
        title={`Welcome, ${ctx.workspace.name}`}
        description="Here's what we're tracking for you right now."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="People in your database"
          value={summary.contactCount.toLocaleString()}
          hint={`${summary.newContacts} new in the last 30 days`}
        />
        <StatTile
          label="Customers"
          value={summary.customerCount.toLocaleString()}
        />
        <StatTile
          label="Active opportunities"
          value={summary.openDealCount.toLocaleString()}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            The latest things that happened with your customers.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {summary.recentActivity.length === 0 ? (
            <p className="text-muted-foreground px-5 pb-5 text-sm">
              Nothing to show yet.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {summary.recentActivity.slice(0, 8).map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.title}</p>
                    {item.contact ? (
                      <p className="text-muted-foreground text-xs">
                        {fullName(item.contact)}
                      </p>
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

      <div className="grid gap-4 md:grid-cols-3">
        {UPCOMING.map((item) => (
          <Card key={item.title} className="p-5">
            <div className="flex items-center justify-between">
              <item.icon className="text-muted-foreground size-5" />
              <Badge variant="outline">{item.phase}</Badge>
            </div>
            <p className="mt-3 font-medium">{item.title}</p>
            <p className="text-muted-foreground mt-1 text-sm">{item.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
