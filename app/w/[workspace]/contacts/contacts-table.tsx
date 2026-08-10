"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge, Card, Select } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { bulkListAction, bulkTagAction, deleteContactsAction } from "./actions";
import { fullName, relativeTime } from "@/lib/utils";

interface Row {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
  lastActivityAt: string | null;
  createdAt: string;
  owner: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "success" | "warning" | "destructive"
> = {
  LEAD: "outline",
  ACTIVE: "default",
  CUSTOMER: "success",
  UNSUBSCRIBED: "warning",
  ARCHIVED: "outline",
};

export function ContactsTable({
  workspace,
  contacts,
  tags,
  lists,
  canDelete,
}: {
  workspace: string;
  contacts: Row[];
  tags: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string }>;
  canDelete: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const allSelected = contacts.length > 0 && selected.length === contacts.length;

  function toggleAll() {
    setSelected(allSelected ? [] : contacts.map((contact) => contact.id));
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      setSelected([]);
    });
  }

  return (
    <Card className="overflow-hidden">
      {selected.length > 0 ? (
        <div className="bg-accent/60 flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-sm font-medium">
            {selected.length} selected
          </span>

          {tags.length > 0 ? (
            <Select
              className="h-8 w-40"
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                const tagId = event.target.value;
                event.target.value = "";
                if (tagId) {
                  run(() => bulkTagAction(workspace, selected, [tagId], "add"));
                }
              }}
            >
              <option value="">Add tag…</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          ) : null}

          {lists.length > 0 ? (
            <Select
              className="h-8 w-40"
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                const listId = event.target.value;
                event.target.value = "";
                if (listId) {
                  run(() =>
                    bulkListAction(workspace, selected, [listId], "add"),
                  );
                }
              }}
            >
              <option value="">Add to list…</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
          ) : null}

          {canDelete ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (
                  !confirm(
                    `Delete ${selected.length} contact(s)? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                run(() => deleteContactsAction(workspace, selected));
              }}
            >
              Delete
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected([])}
            disabled={pending}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all contacts on this page"
                  className="size-4 align-middle"
                />
              </th>
              <th className="px-3 py-2.5 text-left font-medium">Name</th>
              <th className="px-3 py-2.5 text-left font-medium">Contact</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-left font-medium">Tags</th>
              <th className="px-3 py-2.5 text-left font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {contacts.map((contact) => (
              <tr key={contact.id} className="hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.includes(contact.id)}
                    onChange={() => toggle(contact.id)}
                    aria-label={`Select ${fullName(contact)}`}
                    className="size-4 align-middle"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={`/w/${workspace}/contacts/${contact.id}`}
                    className="font-medium hover:underline"
                  >
                    {fullName(contact)}
                  </Link>
                  {contact.company ? (
                    <p className="text-muted-foreground text-xs">
                      {contact.company}
                    </p>
                  ) : null}
                </td>
                <td className="text-muted-foreground px-3 py-2.5">
                  <p>{contact.email ?? "—"}</p>
                  <p className="text-xs">{contact.phone ?? ""}</p>
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={STATUS_VARIANT[contact.status] ?? "outline"}>
                    {contact.status}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag.id} variant="outline">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </Badge>
                    ))}
                    {contact.tags.length > 3 ? (
                      <Badge variant="outline">
                        +{contact.tags.length - 3}
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="text-muted-foreground px-3 py-2.5 text-xs whitespace-nowrap">
                  {relativeTime(contact.lastActivityAt ?? contact.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
