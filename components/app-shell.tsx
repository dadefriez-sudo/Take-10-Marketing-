import Link from "next/link";
import {
  CalendarCheck,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  MessageSquareQuote,
  PhoneCall,
  Send,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import type { TenantContext } from "@/lib/tenant";
import { Badge } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NavLink } from "@/components/nav-link";
import type { WorkspaceOption } from "@/components/types";

/**
 * Nav for the agency surface. Icons are rendered here as elements rather than
 * passed as component types, because NavLink is a client component and a
 * forwardRef component can't cross that boundary as a prop.
 *
 * The three disabled entries are the phases this platform is being built
 * toward; they're shown rather than hidden so the shape of the product stays
 * visible while it's under construction.
 */
function navigation(slug: string) {
  return {
    live: [
      {
        href: `/w/${slug}`,
        label: "Dashboard",
        icon: <LayoutDashboard className="size-4" />,
        exact: true,
      },
      {
        href: `/w/${slug}/contacts`,
        label: "Contacts",
        icon: <Users className="size-4" />,
      },
      {
        href: `/w/${slug}/deals`,
        label: "Deals",
        icon: <KanbanSquare className="size-4" />,
      },
      {
        href: `/w/${slug}/inbox`,
        label: "Inbox",
        icon: <Inbox className="size-4" />,
      },
      {
        href: `/w/${slug}/automations`,
        label: "Automations",
        icon: <Workflow className="size-4" />,
      },
      {
        href: `/w/${slug}/campaigns`,
        label: "Campaigns",
        icon: <Send className="size-4" />,
      },
      {
        href: `/w/${slug}/tasks`,
        label: "Tasks",
        icon: <ListChecks className="size-4" />,
      },
      {
        href: `/w/${slug}/settings`,
        label: "Settings",
        icon: <Settings className="size-4" />,
      },
    ],
    upcoming: [
      {
        label: "Booking",
        icon: <CalendarCheck className="size-4" />,
        phase: "Phase 3",
      },
      {
        label: "Reviews",
        icon: <MessageSquareQuote className="size-4" />,
        phase: "Phase 4",
      },
      {
        label: "Calls",
        icon: <PhoneCall className="size-4" />,
        phase: "Phase 5",
      },
    ],
  };
}

export function AppShell({
  ctx,
  workspaces,
  children,
}: {
  ctx: TenantContext;
  workspaces: WorkspaceOption[];
  children: React.ReactNode;
}) {
  const nav = navigation(ctx.workspace.slug);

  return (
    <div className="flex min-h-svh">
      <aside className="bg-card hidden w-60 shrink-0 flex-col border-r border-border lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
            10
          </span>
          <span className="truncate text-sm font-semibold">
            {ctx.organization.name}
          </span>
        </div>

        <div className="border-b border-border p-3">
          <WorkspaceSwitcher
            current={{ name: ctx.workspace.name, slug: ctx.workspace.slug }}
            workspaces={workspaces}
          />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.live.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              exact={item.exact}
            >
              {item.icon}
            </NavLink>
          ))}

          <p className="text-muted-foreground px-3 pt-5 pb-2 text-xs font-medium tracking-wide uppercase">
            Coming next
          </p>
          {nav.upcoming.map((item) => (
            <div
              key={item.label}
              className="text-muted-foreground/60 flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm"
              title={`${item.label} lands in ${item.phase}`}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              <Badge variant="outline" className="text-[10px]">
                {item.phase}
              </Badge>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <SignOutButton className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card/80 sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
              10
            </span>
            <Link
              href={`/w/${ctx.workspace.slug}`}
              className="text-sm font-semibold"
            >
              {ctx.workspace.name}
            </Link>
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <span className="text-sm font-medium">{ctx.workspace.name}</span>
            <Badge variant="outline">{ctx.role}</Badge>
            <span className="text-muted-foreground text-xs">
              {ctx.workspace.timezone}
            </span>
          </div>
          <nav className="flex items-center gap-1 lg:hidden">
            {nav.live.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                exact={item.exact}
                compact
              >
                {item.icon}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
