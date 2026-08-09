import { db } from "@/lib/db";
import { can, requireTenant } from "@/lib/tenant";
import { listLists, listTags } from "@/lib/repos/crm";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);

  const [full, members, invitations, tags, lists] = await Promise.all([
    db.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    db.membership.findMany({
      where: { organizationId: ctx.organizationId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        workspace: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { organizationId: ctx.organizationId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    listTags(ctx),
    listLists(ctx),
  ]);

  const canManage = can(ctx.role, "workspace:update");
  const canInvite = can(ctx.role, "member:invite");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Settings"
        description={`${ctx.organization.name} · ${ctx.workspace.name}`}
      />

      <SettingsForms
        workspace={workspace}
        canManage={canManage}
        canInvite={canInvite}
        current={{
          name: full?.name ?? ctx.workspace.name,
          timezone: full?.timezone ?? ctx.workspace.timezone,
          industry: full?.industry ?? "",
          websiteUrl: full?.websiteUrl ?? "",
          phone: full?.phone ?? "",
        }}
        tags={tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          count: tag._count.contacts,
        }))}
        lists={lists.map((list) => ({
          id: list.id,
          name: list.name,
          count: list._count.contacts,
        }))}
        invitations={invitations.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: formatDate(invite.expiresAt),
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Agency roles reach every client workspace. A CLIENT login only ever
            sees the one workspace it was invited to.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-border divide-y">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.user.name ?? member.user.email}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {member.user.email}
                    {member.workspace ? ` · ${member.workspace.name}` : ""}
                  </p>
                </div>
                <Badge variant={member.role === "CLIENT" ? "outline" : "default"}>
                  {member.role}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
