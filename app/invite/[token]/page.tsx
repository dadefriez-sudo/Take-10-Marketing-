import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Accept invitation" };

/** Kept out of the component body so the clock read isn't a render-time call. */
function isUsable(invitation: { acceptedAt: Date | null; expiresAt: Date }) {
  return (
    invitation.acceptedAt === null &&
    invitation.expiresAt.getTime() >= Date.now()
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await db.invitation.findUnique({
    where: { token },
    include: {
      organization: { select: { name: true } },
      workspace: { select: { name: true, slug: true } },
    },
  });

  const invalid = !invitation || !isUsable(invitation);

  if (invalid) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>This invitation isn&apos;t valid</CardTitle>
            <CardDescription>
              It may have expired, been revoked, or already been used. Ask
              whoever invited you to send a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const session = await auth();

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Join {invitation.organization.name}</CardTitle>
          <CardDescription>
            You were invited as <strong>{invitation.role}</strong>
            {invitation.workspace ? ` for ${invitation.workspace.name}` : ""}.
            The invitation is tied to {invitation.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInviteForm
            token={token}
            email={invitation.email}
            signedInAs={session?.user?.email ?? null}
          />
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg text-sm font-bold">
          10
        </span>
        <span className="text-lg font-semibold tracking-tight">
          Take 10 Marketing
        </span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
