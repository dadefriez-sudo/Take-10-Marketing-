"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth, hashPassword, signIn } from "@/lib/auth";

export interface InviteState {
  error?: string;
}

const acceptSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().max(120).optional(),
  password: z.string().min(10, "Use at least 10 characters").max(200).optional(),
});

/**
 * Accept an invitation.
 *
 * Two paths: an already signed-in user whose email matches simply gains the
 * membership; a new person sets a password and gets an account. In both cases
 * the invitation's email is authoritative — it is never taken from the form.
 */
export async function acceptInviteAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const parsed = acceptSchema.safeParse({
    token: formData.get("token"),
    name: String(formData.get("name") ?? "") || undefined,
    password: String(formData.get("password") ?? "") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details" };
  }

  const invitation = await db.invitation.findUnique({
    where: { token: parsed.data.token },
  });

  if (
    !invitation ||
    invitation.acceptedAt !== null ||
    invitation.expiresAt.getTime() < Date.now()
  ) {
    return { error: "That invitation is no longer valid." };
  }

  const session = await auth();
  const signedInEmail = session?.user?.email?.toLowerCase();

  if (signedInEmail && signedInEmail !== invitation.email) {
    return {
      error: `This invitation is for ${invitation.email}, but you're signed in as ${signedInEmail}. Sign out first.`,
    };
  }

  let user = await db.user.findUnique({ where: { email: invitation.email } });

  if (!user) {
    if (!parsed.data.password) {
      return { error: "Choose a password to finish setting up your account." };
    }
    user = await db.user.create({
      data: {
        email: invitation.email,
        name: parsed.data.name || null,
        passwordHash: await hashPassword(parsed.data.password),
        // Holding the invitation link proves control of the mailbox.
        emailVerified: new Date(),
      },
    });
  }

  // Not an upsert: workspaceId is nullable, and Prisma's compound-unique input
  // does not accept null, so the lookup has to be a findFirst.
  const existingMembership = await db.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: invitation.organizationId,
      workspaceId: invitation.workspaceId,
    },
    select: { id: true },
  });

  if (existingMembership) {
    await db.membership.update({
      where: { id: existingMembership.id },
      data: { role: invitation.role },
    });
  } else {
    await db.membership.create({
      data: {
        userId: user.id,
        organizationId: invitation.organizationId,
        workspaceId: invitation.workspaceId,
        role: invitation.role,
      },
    });
  }

  await db.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  });

  await db.auditLog.create({
    data: {
      organizationId: invitation.organizationId,
      workspaceId: invitation.workspaceId,
      actorUserId: user.id,
      action: "invitation.accepted",
      targetType: "Invitation",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    },
  });

  if (signedInEmail) {
    // Already authenticated — nothing more to do than send them onward.
    return {};
  }

  try {
    await signIn("password", {
      email: invitation.email,
      password: parsed.data.password,
      redirectTo: "/workspaces",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account ready — please sign in." };
    }
    throw error;
  }

  return {};
}
