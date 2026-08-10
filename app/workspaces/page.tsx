import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2 } from "lucide-react";
import { requireUser, listAccessibleWorkspaces } from "@/lib/tenant";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata = { title: "Choose a workspace" };

export default async function WorkspacesPage() {
  const user = await requireUser();
  const workspaces = await listAccessibleWorkspaces(user.id);

  // A client with exactly one workspace has no choice to make.
  if (workspaces.length === 1 && workspaces[0]!.role === "CLIENT") {
    redirect(`/portal/${workspaces[0]!.slug}`);
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground text-sm">
            Signed in as {user.email}
          </p>
        </div>
        <SignOutButton />
      </div>

      {workspaces.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No workspaces yet"
            description="You don't belong to any workspace. Ask an admin to invite you, or create a new agency account."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={
                workspace.role === "CLIENT"
                  ? `/portal/${workspace.slug}`
                  : `/w/${workspace.slug}`
              }
              className="group"
            >
              <Card className="hover:border-primary/40 transition-colors">
                <CardHeader className="flex-row items-center justify-between pb-5">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      {workspace.name}
                      <Badge variant="outline">{workspace.role}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {workspace.organizationName} · {workspace.timezone}
                    </CardDescription>
                  </div>
                  <ArrowRight className="text-muted-foreground group-hover:text-primary size-4 transition-colors" />
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Development</CardTitle>
          <CardDescription>
            No email provider is configured, so outbound mail is captured
            instead of sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/dev/inbox"
            className="text-primary text-sm hover:underline"
          >
            Open the dev inbox →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
