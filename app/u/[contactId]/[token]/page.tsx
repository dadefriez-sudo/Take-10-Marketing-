import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { unsubscribeToken } from "@/lib/messaging/send";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata = { title: "Unsubscribe" };
export const dynamic = "force-dynamic";

/**
 * The public opt-out page every marketing email footer links to.
 *
 * No login: requiring one would make the opt-out fail for most recipients,
 * which is exactly the kind of friction CAN-SPAM's "clearly and conspicuously"
 * language exists to prevent. The signed token in the URL is the authorization.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ contactId: string; token: string }>;
}) {
  const { contactId, token } = await params;

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      email: true,
      workspaceId: true,
      status: true,
      workspace: { select: { name: true } },
    },
  });

  if (!contact || !contact.email) notFound();

  // Token is derived from the workspace and contact, so a guessed contact id
  // is not enough to opt someone out.
  if (token !== unsubscribeToken(contact.workspaceId, contact.id)) notFound();

  const alreadyOff = await db.suppression.findUnique({
    where: {
      workspaceId_channel_address: {
        workspaceId: contact.workspaceId,
        channel: "EMAIL",
        address: contact.email.toLowerCase(),
      },
    },
    select: { id: true },
  });

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {alreadyOff ? "You're unsubscribed" : "Unsubscribe"}
          </CardTitle>
          <CardDescription>
            {alreadyOff
              ? `${contact.email} will not receive further marketing email from ${contact.workspace.name}.`
              : `Stop marketing email from ${contact.workspace.name} to ${contact.email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UnsubscribeForm
            contactId={contact.id}
            token={token}
            alreadyUnsubscribed={Boolean(alreadyOff)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
