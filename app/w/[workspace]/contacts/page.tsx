import Link from "next/link";
import { Users } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { listContacts, CONTACT_PAGE_SIZE } from "@/lib/repos/contacts";
import { listLists, listSegments, listTags } from "@/lib/repos/crm";
import { parseSegmentDefinition } from "@/lib/segments/compile";
import type { SegmentGroup } from "@/lib/segments/types";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { ContactsTable } from "./contacts-table";
import { ContactFilters } from "./contact-filters";
import { NewContactPanel } from "./new-contact-panel";

export const metadata = { title: "Contacts" };

type Search = {
  q?: string;
  page?: string;
  tag?: string | string[];
  list?: string | string[];
  status?: string;
  segment?: string;
  sort?: string;
  new?: string;
};

function asArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Search>;
}) {
  const { workspace } = await params;
  const search = await searchParams;
  const ctx = await requireTenant(workspace);

  const [tags, lists, segments] = await Promise.all([
    listTags(ctx),
    listLists(ctx),
    listSegments(ctx),
  ]);

  const activeSegment = search.segment
    ? segments.find((segment) => segment.id === search.segment)
    : undefined;

  let segmentDefinition: SegmentGroup | null = null;
  let segmentError: string | null = null;
  if (activeSegment) {
    try {
      segmentDefinition = parseSegmentDefinition(activeSegment.definition);
    } catch {
      // A malformed saved segment must not take the whole page down.
      segmentError = `Saved segment "${activeSegment.name}" is malformed and was ignored.`;
    }
  }

  const page = Number(search.page ?? "1") || 1;
  const status = search.status as
    | "LEAD"
    | "ACTIVE"
    | "CUSTOMER"
    | "UNSUBSCRIBED"
    | "ARCHIVED"
    | undefined;

  const result = await listContacts(ctx, {
    search: search.q,
    page,
    segment: segmentDefinition,
    tagIds: asArray(search.tag),
    listIds: asArray(search.list),
    status: status ?? null,
    sort: (search.sort as "recent" | "created" | "name") ?? "recent",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description={`${result.total.toLocaleString()} contact${
          result.total === 1 ? "" : "s"
        } in ${ctx.workspace.name}`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/w/${workspace}/contacts/import`}>Import CSV</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/w/${workspace}/contacts/export`}>Export</Link>
            </Button>
          </>
        }
      />

      {segmentError ? (
        <p className="text-destructive text-sm">{segmentError}</p>
      ) : null}

      <NewContactPanel workspace={workspace} open={search.new === "1"} />

      <ContactFilters
        workspace={workspace}
        tags={tags}
        lists={lists}
        segments={segments}
        active={{
          q: search.q ?? "",
          tag: asArray(search.tag),
          list: asArray(search.list),
          status: search.status ?? "",
          segment: search.segment ?? "",
          sort: search.sort ?? "recent",
        }}
      />

      {result.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No contacts match"
            description="Adjust the filters, import a CSV, or add someone manually."
            action={
              <Button asChild>
                <Link href={`/w/${workspace}/contacts?new=1`}>Add contact</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ContactsTable
          workspace={workspace}
          contacts={result.items.map((contact) => ({
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            company: contact.company,
            status: contact.status,
            lastActivityAt: contact.lastActivityAt?.toISOString() ?? null,
            createdAt: contact.createdAt.toISOString(),
            owner: contact.owner?.name ?? contact.owner?.email ?? null,
            tags: contact.tags.map((link) => ({
              id: link.tag.id,
              name: link.tag.name,
              color: link.tag.color,
            })),
          }))}
          tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          lists={lists.map((list) => ({ id: list.id, name: list.name }))}
          canDelete={ctx.role === "OWNER" || ctx.role === "ADMIN"}
        />
      )}

      {result.pageCount > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Page {result.page} of {result.pageCount} · showing up to{" "}
            {CONTACT_PAGE_SIZE} per page
          </p>
          <div className="flex gap-2">
            <PageLink
              workspace={workspace}
              search={search}
              page={result.page - 1}
              disabled={result.page <= 1}
              label="Previous"
            />
            <PageLink
              workspace={workspace}
              search={search}
              page={result.page + 1}
              disabled={result.page >= result.pageCount}
              label="Next"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageLink({
  workspace,
  search,
  page,
  disabled,
  label,
}: {
  workspace: string;
  search: Search;
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <Badge variant="outline" className="px-3 py-1.5 opacity-50">
        {label}
      </Badge>
    );
  }

  const query = new URLSearchParams();
  if (search.q) query.set("q", search.q);
  if (search.status) query.set("status", search.status);
  if (search.segment) query.set("segment", search.segment);
  if (search.sort) query.set("sort", search.sort);
  for (const tag of asArray(search.tag)) query.append("tag", tag);
  for (const list of asArray(search.list)) query.append("list", list);
  query.set("page", String(page));

  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={`/w/${workspace}/contacts?${query.toString()}`}>{label}</Link>
    </Button>
  );
}
