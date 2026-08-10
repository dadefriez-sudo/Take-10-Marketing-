import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { getContact } from "@/lib/repos/contacts";
import { listActivity } from "@/lib/repos/crm";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import {
  formatCurrency,
  formatDate,
  fullName,
  relativeTime,
} from "@/lib/utils";
import { ContactEditor } from "./contact-editor";
import { NoteComposer } from "./note-composer";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; contactId: string }>;
}) {
  const { workspace, contactId } = await params;
  const ctx = await requireTenant(workspace);

  const contact = await getContact(ctx, contactId);
  if (!contact) notFound();

  const timeline = await listActivity(ctx, { contactId, take: 40 });
  const name = fullName(contact);

  return (
    <div className="space-y-6">
      <Link
        href={`/w/${workspace}/contacts`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> All contacts
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-muted-foreground text-sm">
            {contact.company ? `${contact.company} · ` : ""}
            Added {formatDate(contact.createdAt, ctx.workspace.timezone)}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge>{contact.status}</Badge>
            {contact.tags.map((link) => (
              <Badge key={link.tag.id} variant="outline">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: link.tag.color }}
                />
                {link.tag.name}
              </Badge>
            ))}
            {contact.lists.map((link) => (
              <Badge key={link.list.id} variant="outline">
                ☰ {link.list.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <NoteComposer workspace={workspace} contactId={contact.id} />

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {timeline.length === 0 ? (
                <p className="text-muted-foreground px-5 pb-5 text-sm">
                  Nothing has happened with this contact yet.
                </p>
              ) : (
                <ol className="divide-border divide-y">
                  {timeline.map((entry) => (
                    <li key={entry.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm">{entry.title}</p>
                          {entry.body ? (
                            <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                              {entry.body}
                            </p>
                          ) : null}
                          <p className="text-muted-foreground text-xs">
                            {entry.type}
                            {entry.actor
                              ? ` · ${entry.actor.name ?? entry.actor.email}`
                              : ""}
                          </p>
                        </div>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {relativeTime(entry.occurredAt)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <ContactEditor
            workspace={workspace}
            contact={{
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              company: contact.company,
              jobTitle: contact.jobTitle,
              status: contact.status,
              source: contact.source,
            }}
          />

          {contact.fieldValues.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Custom fields</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contact.fieldValues.map((value) => (
                  <div
                    key={value.id}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {value.field.label}
                    </span>
                    <span className="text-right font-medium">
                      {String(value.value ?? "—")}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {contact.deals.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Deals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contact.deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{deal.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {deal.stage.name}
                      </p>
                    </div>
                    <span className="tabular-nums">
                      {formatCurrency(Number(deal.value), deal.currency)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {contact.tasks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contact.tasks.map((task) => (
                  <div key={task.id} className="text-sm">
                    <p
                      className={
                        task.completedAt
                          ? "text-muted-foreground line-through"
                          : ""
                      }
                    >
                      {task.title}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {task.dueAt
                        ? `Due ${formatDate(task.dueAt, ctx.workspace.timezone)}`
                        : "No due date"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
