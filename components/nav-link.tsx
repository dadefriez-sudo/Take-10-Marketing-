"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Takes the icon as rendered children rather than as a component type: this is
 * a client component, and a forwardRef component (which is what lucide exports)
 * cannot be passed across the server/client boundary as a prop.
 */
export function NavLink({
  href,
  label,
  exact = false,
  compact = false,
  children,
}: {
  href: string;
  label: string;
  exact?: boolean;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={compact ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        compact && "px-2 py-2",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      {compact ? <span className="sr-only">{label}</span> : label}
    </Link>
  );
}
