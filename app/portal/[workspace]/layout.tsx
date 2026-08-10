import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { Badge } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The client-facing surface. Deliberately separate from the agency app rather
 * than the same pages with things hidden — from Phase 4 this is where clients
 * approve posts and read reports, and it needs its own white-label shell.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const ctx = await requireTenant(workspace);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-card flex h-14 items-center justify-between gap-3 border-b border-border px-4 lg:px-8">
        <div className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
            10
          </span>
          <Link href={`/portal/${workspace}`} className="text-sm font-semibold">
            {ctx.workspace.name}
          </Link>
          {ctx.isStaff ? <Badge variant="outline">Staff preview</Badge> : null}
        </div>
        <div className="flex items-center gap-3">
          {ctx.isStaff ? (
            <Link
              href={`/w/${workspace}`}
              className="text-muted-foreground hover:text-foreground text-sm hover:underline"
            >
              Back to agency view
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 lg:px-8">
        {children}
      </main>

      <footer className="text-muted-foreground border-t border-border px-4 py-4 text-center text-xs">
        Powered by {ctx.organization.name}
      </footer>
    </div>
  );
}
