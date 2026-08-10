"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, writeAuditLog } from "@/lib/tenant";
import { appUrl, generateToken, INVITE_TTL_DAYS } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/providers/email";
import { ensureDefaultPipeline } from "@/lib/repos/deals";
import { createList, createTag } from "@/lib/repos/crm";
import { slugify } from "@/lib/utils";

export interface SettingsState {
  error?: string;
  success?: string;
}

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "Name the client").max(120),
  timezone: z.string().trim().min(1).max(64),
  industry: z.string().trim().max(80).optional(),
  websiteUrl: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
});

export async function updateWorkspaceAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "workspace:update");

  const parsed = workspaceSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    industry: formData.get("industry") ?? undefined,
    websiteUrl: formData.get("websiteUrl") ?? undefined,
    phone: formData.get("phone") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  // An invalid IANA zone would silently break booking availability and
  // messaging quiet hours in later phases, so reject it here.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    return { error: `"${parsed.data.timezone}" is not a valid time zone` };
  }

  await db.workspace.update({
    where: { id: ctx.workspaceId },
    data: {
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      industry: parsed.data.industry || null,
      websiteUrl: parsed.data.websiteUrl || null,
      phone: parsed.data.phone || null,
    },
  });

  await writeAuditLog(ctx, "workspace.updated", {
    targetType: "Workspace",
    targetId: ctx.workspaceId,
  });

  revalidatePath(`/w/${workspace}/settings`);
  return { success: "Saved" };
}

export async function createWorkspaceAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "workspace:create");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the new client" };

  const root = slugify(name) || "client";
  let slug = root;
  let suffix = 2;
  while (
    await db.workspace.findUnique({
      where: {
        organizationId_slug: { organizationId: ctx.organizationId, slug },
      },
    })
  ) {
    slug = `${root}-${suffix++}`;
  }

  const created = await db.workspace.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      slug,
      timezone: ctx.workspace.timezone,
    },
  });

  await ensureDefaultPipeline(created.id);
  await writeAuditLog(ctx, "workspace.created", {
    targetType: "Workspace",
    targetId: created.id,
    metadata: { name, slug },
  });

  revalidatePath("/workspaces");
  revalidatePath(`/w/${workspace}/settings`);
  return { success: `Created "${name}". Switch to it from the client picker.` };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  role: z.enum(["ADMIN", "MEMBER", "CLIENT"]),
});

export async function inviteMemberAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const workspace = String(formData.get("workspace") ?? "");
  const ctx = await requirePermission(workspace, "member:invite");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  const { email, role } = parsed.data;

  const existing = await db.membership.findFirst({
    where: { user: { email }, organizationId: ctx.organizationId },
  });
  if (existing) {
    return { error: "That person is already on this organization" };
  }

  const token = generateToken();
  await db.invitation.create({
    data: {
      organizationId: ctx.organizationId,
      // A CLIENT invite is pinned to this workspace; staff invites are org-wide.
      workspaceId: role === "CLIENT" ? ctx.workspaceId : null,
      email,
      role,
      token,
      invitedById: ctx.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    },
  });

  const link = appUrl(`/invite/${token}`);
  await sendEmail({
    to: email,
    subject: `You've been invited to ${ctx.organization.name}`,
    html: `
      <p>You've been invited to join <strong>${ctx.organization.name}</strong>${
        role === "CLIENT" ? ` for ${ctx.workspace.name}` : ""
      } as ${role}.</p>
      <p><a href="${link}">Accept the invitation</a></p>
      <p style="color:#64748b;font-size:12px">This link expires in ${INVITE_TTL_DAYS} days.</p>
    `,
    metadata: { kind: "invitation", role },
  });

  await writeAuditLog(ctx, "member.invited", { metadata: { email, role } });

  revalidatePath(`/w/${workspace}/settings`);
  return {
    success: `Invitation sent to ${email}. With no email provider configured it's waiting at /dev/inbox.`,
  };
}

export async function revokeInviteAction(
  workspace: string,
  invitationId: string,
): Promise<SettingsState> {
  const ctx = await requirePermission(workspace, "member:invite");
  await db.invitation.deleteMany({
    where: { id: invitationId, organizationId: ctx.organizationId },
  });
  revalidatePath(`/w/${workspace}/settings`);
  return { success: "Invitation revoked" };
}

export async function removeMemberAction(
  workspace: string,
  membershipId: string,
): Promise<SettingsState> {
  const ctx = await requirePermission(workspace, "member:remove");

  const membership = await db.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
  });
  if (!membership) return { error: "That member no longer exists" };
  if (membership.userId === ctx.userId) {
    return { error: "You can't remove yourself" };
  }

  // Never leave an organization without an owner.
  if (membership.role === "OWNER") {
    const owners = await db.membership.count({
      where: { organizationId: ctx.organizationId, role: "OWNER" },
    });
    if (owners <= 1) return { error: "An organization needs at least one owner" };
  }

  await db.membership.delete({ where: { id: membershipId } });
  await writeAuditLog(ctx, "member.removed", {
    metadata: { membershipId, role: membership.role },
  });

  revalidatePath(`/w/${workspace}/settings`);
  return { success: "Member removed" };
}

export async function createTagAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const workspace = String(formData.get("workspace") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a tag name" };

  const ctx = await requirePermission(workspace, "contact:write");
  await createTag(ctx, name, String(formData.get("color") ?? "") || undefined);

  revalidatePath(`/w/${workspace}/settings`);
  return { success: `Created tag "${name}"` };
}

export async function createListAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const workspace = String(formData.get("workspace") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a list name" };

  const ctx = await requirePermission(workspace, "contact:write");
  await createList(ctx, name);

  revalidatePath(`/w/${workspace}/settings`);
  return { success: `Created list "${name}"` };
}
