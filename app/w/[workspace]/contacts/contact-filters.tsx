"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";
import { Badge, Card, Input, Select } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  name: string;
  color?: string;
}

export function ContactFilters({
  workspace,
  tags,
  lists,
  segments,
  active,
}: {
  workspace: string;
  tags: Option[];
  lists: Option[];
  segments: Array<{ id: string; name: string }>;
  active: {
    q: string;
    tag: string[];
    list: string[];
    status: string;
    segment: string;
    sort: string;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    // Any filter change invalidates the current page offset.
    next.delete("page");
    next.delete("new");
    startTransition(() => {
      router.push(`/w/${workspace}/contacts?${next.toString()}`);
    });
  }

  function toggleMulti(key: "tag" | "list", id: string) {
    apply((next) => {
      const current = next.getAll(key);
      next.delete(key);
      const updated = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      for (const value of updated) next.append(key, value);
    });
  }

  const hasFilters =
    active.q ||
    active.tag.length > 0 ||
    active.list.length > 0 ||
    active.status ||
    active.segment;

  return (
    <Card className={cn("p-4", pending && "opacity-70")}>
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="min-w-56 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            apply((next) => {
              const term = String(value ?? "").trim();
              if (term) next.set("q", term);
              else next.delete("q");
            });
          }}
        >
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
            <Input
              name="q"
              defaultValue={active.q}
              placeholder="Search name, email, phone, company…"
              className="pl-8"
            />
          </div>
        </form>

        <Select
          className="w-40"
          value={active.status}
          onChange={(event) =>
            apply((next) => {
              if (event.target.value) next.set("status", event.target.value);
              else next.delete("status");
            })
          }
        >
          <option value="">Any status</option>
          <option value="LEAD">Lead</option>
          <option value="ACTIVE">Active</option>
          <option value="CUSTOMER">Customer</option>
          <option value="UNSUBSCRIBED">Unsubscribed</option>
          <option value="ARCHIVED">Archived</option>
        </Select>

        {segments.length > 0 ? (
          <Select
            className="w-48"
            value={active.segment}
            onChange={(event) =>
              apply((next) => {
                if (event.target.value)
                  next.set("segment", event.target.value);
                else next.delete("segment");
              })
            }
          >
            <option value="">No saved segment</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          className="w-40"
          value={active.sort}
          onChange={(event) =>
            apply((next) => next.set("sort", event.target.value))
          }
        >
          <option value="recent">Recent activity</option>
          <option value="created">Newest first</option>
          <option value="name">Name A–Z</option>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              startTransition(() => router.push(`/w/${workspace}/contacts`))
            }
          >
            <X className="size-3.5" /> Clear
          </Button>
        ) : null}
      </div>

      {(tags.length > 0 || lists.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => {
            const selected = active.tag.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleMulti("tag", tag.id)}
                aria-pressed={selected}
              >
                <Badge
                  variant={selected ? "default" : "outline"}
                  className="cursor-pointer"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color ?? "#64748B" }}
                  />
                  {tag.name}
                </Badge>
              </button>
            );
          })}
          {lists.map((list) => {
            const selected = active.list.includes(list.id);
            return (
              <button
                key={list.id}
                type="button"
                onClick={() => toggleMulti("list", list.id)}
                aria-pressed={selected}
              >
                <Badge
                  variant={selected ? "default" : "outline"}
                  className="cursor-pointer"
                >
                  ☰ {list.name}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
