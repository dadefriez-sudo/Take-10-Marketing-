import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

/**
 * The scope every data access runs under.
 *
 * Repositories in lib/repos take this as a required argument rather than
 * reading it from a global, so a query written without a tenant simply does not
 * compile. Nothing in the app should query a workspace-owned table without one.
 */
export interface TenantContext {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: Role;
  /** True for agency staff (OWNER/ADMIN/MEMBER), false for client logins. */
  isStaff: boolean;
  workspace: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
}

export class TenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAccessError";
  }
}

/** Permissions, keyed by role. Deliberately small and explicit. */
export const PERMISSIONS = {
  "org:manage": ["OWNER", "ADMIN"],
  "org:billing": ["OWNER"],
  "member:invite": ["OWNER", "ADMIN"],
  "member:remove": ["OWNER", "ADMIN"],
  "workspace:create": ["OWNER", "ADMIN"],
  "workspace:update": ["OWNER", "ADMIN"],
  "workspace:delete": ["OWNER"],
  "contact:read": ["OWNER", "ADMIN", "MEMBER", "CLIENT"],
  "contact:write": ["OWNER", "ADMIN", "MEMBER"],
  "contact:delete": ["OWNER", "ADMIN"],
  "contact:import": ["OWNER", "ADMIN", "MEMBER"],
  "contact:export": ["OWNER", "ADMIN"],
  "deal:read": ["OWNER", "ADMIN", "MEMBER", "CLIENT"],
  "deal:write": ["OWNER", "ADMIN", "MEMBER"],
  "task:read": ["OWNER", "ADMIN", "MEMBER"],
  "task:write": ["OWNER", "ADMIN", "MEMBER"],
  "segment:write": ["OWNER", "ADMIN", "MEMBER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function assertCan(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx.role, permission)) {
    throw new TenantAccessError(
      `Role ${ctx.role} is not permitted to ${permission}`,
    );
  }
}

/**
 * Resolve the tenant for a workspace slug, verifying membership in the same
 * query. Returns null when the workspace does not exist *or* the user has no
 * membership — the two are deliberately indistinguishable so workspace slugs
 * cannot be enumerated.
 */
export const resolveTenant = cache(
  async (workspaceSlug: string): Promise<TenantContext | null> => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return null;

    const membership = await db.membership.findFirst({
      where: {
        userId,
        organization: {
          workspaces: { some: { slug: workspaceSlug, archivedAt: null } },
        },
        OR: [
          // Agency staff: org-wide membership reaches every workspace.
          { workspaceId: null },
          // Client: must be pinned to this specific workspace.
          { workspace: { slug: workspaceSlug } },
        ],
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            workspaces: {
              where: { slug: workspaceSlug, archivedAt: null },
              select: { id: true, name: true, slug: true, timezone: true },
              take: 1,
            },
          },
        },
      },
      // A user with both a staff and a client row gets the staff one.
      orderBy: { workspaceId: "asc" },
    });

    const workspace = membership?.organization.workspaces[0];
    if (!membership || !workspace) return null;

    return {
      userId,
      organizationId: membership.organizationId,
      workspaceId: workspace.id,
      role: membership.role,
      isStaff: membership.role !== "CLIENT",
      workspace,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
      },
    };
  },
);

/** Tenant or redirect. The standard guard for a page or layout. */
export async function requireTenant(
  workspaceSlug: string,
): Promise<TenantContext> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=/w/${encodeURIComponent(workspaceSlug)}`);
  }

  const ctx = await resolveTenant(workspaceSlug);
  if (!ctx) redirect("/workspaces");
  return ctx;
}

/** Tenant with a permission check, for server actions. */
export async function requirePermission(
  workspaceSlug: string,
  permission: Permission,
): Promise<TenantContext> {
  const ctx = await requireTenant(workspaceSlug);
  assertCan(ctx, permission);
  return ctx;
}

export const requireUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
});

/** Every workspace the signed-in user can reach, for the switcher. */
export async function listAccessibleWorkspaces(userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          workspaces: {
            where: { archivedAt: null },
            select: { id: true, name: true, slug: true, timezone: true },
            orderBy: { name: "asc" },
          },
        },
      },
      workspace: {
        select: { id: true, name: true, slug: true, timezone: true },
      },
    },
  });

  const seen = new Set<string>();
  const result: Array<{
    id: string;
    name: string;
    slug: string;
    timezone: string;
    organizationName: string;
    role: Role;
  }> = [];

  for (const membership of memberships) {
    const workspaces = membership.workspaceId
      ? membership.workspace
        ? [membership.workspace]
        : []
      : membership.organization.workspaces;

    for (const workspace of workspaces) {
      if (seen.has(workspace.id)) continue;
      seen.add(workspace.id);
      result.push({
        ...workspace,
        organizationName: membership.organization.name,
        role: membership.role,
      });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeAuditLog(
  ctx: TenantContext,
  action: string,
  details: {
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action,
      targetType: details.targetType,
      targetId: details.targetId,
      metadata: (details.metadata ?? {}) as object,
    },
  });
}
