"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown } from "lucide-react";
import type { WorkspaceOption } from "@/components/types";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: { name: string; slug: string };
  workspaces: WorkspaceOption[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "bg-card border-border hover:bg-muted flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-sm transition-colors",
        )}
      >
        <span className="min-w-0">
          <span className="text-muted-foreground block text-[10px] tracking-wide uppercase">
            Client
          </span>
          <span className="block truncate font-medium">{current.name}</span>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="bg-card border-border z-50 max-h-80 w-56 overflow-y-auto rounded-md border p-1 shadow-lg"
        >
          {workspaces.map((workspace) => (
            <DropdownMenu.Item key={workspace.id} asChild>
              <Link
                href={`/w/${workspace.slug}`}
                className={cn(
                  "hover:bg-muted flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                  workspace.slug === current.slug && "bg-accent",
                )}
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
                {workspace.slug === current.slug ? (
                  <Check className="size-3.5 shrink-0" />
                ) : null}
              </Link>
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Separator className="bg-border my-1 h-px" />
          <DropdownMenu.Item asChild>
            <Link
              href="/workspaces"
              className="hover:bg-muted block cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none"
            >
              All workspaces
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
