import { redirect } from "next/navigation";
import { listAccessibleWorkspaces, requireTenant } from "@/lib/tenant";
import { AppShell } from "@/components/app-shell";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);

  // Clients never see the agency surface, even by typing the URL.
  if (!ctx.isStaff) redirect(`/portal/${ctx.workspace.slug}`);

  const workspaces = await listAccessibleWorkspaces(ctx.userId);

  return (
    <AppShell ctx={ctx} workspaces={workspaces}>
      {children}
    </AppShell>
  );
}
