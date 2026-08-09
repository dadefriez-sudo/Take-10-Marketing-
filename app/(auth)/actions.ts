"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, hashPassword } from "@/lib/auth";
import { appUrl, createMagicLinkToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/providers/email";
import { ensureDefaultPipeline } from "@/lib/repos/deals";
import { slugify } from "@/lib/utils";

export interface ActionState {
  error?: string;
  notice?: string;
}

const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  organizationName: z
    .string()
    .trim()
    .min(1, "Agency name is required")
    .max(120),
});

async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || "workspace";
  let candidate = root;
  let suffix = 2;
  while (await exists(candidate)) {
    candidate = `${root}-${suffix++}`;
  }
  return candidate;
}

export async function signupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organizationName: formData.get("organizationName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details" };
  }

  const { name, email, password, organizationName } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists" };
  }

  const orgSlug = await uniqueSlug(organizationName, async (slug) =>
    Boolean(await db.organization.findUnique({ where: { slug } })),
  );

  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
    },
  });

  const organization = await db.organization.create({
    data: { name: organizationName, slug: orgSlug },
  });

  // The signup creates the agency AND its first client workspace, so a new
  // account lands on a usable CRM instead of an empty shell.
  const workspace = await db.workspace.create({
    data: {
      organizationId: organization.id,
      name: "My first client",
      slug: "first-client",
    },
  });

  await db.membership.create({
    data: {
      userId: user.id,
      organizationId: organization.id,
      role: "OWNER",
    },
  });

  await ensureDefaultPipeline(workspace.id);

  await db.auditLog.create({
    data: {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
    },
  });

  try {
    await signIn("password", {
      email,
      password,
      redirectTo: `/w/${workspace.slug}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created — please sign in." };
    }
    throw error;
  }

  return {};
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(1, "Password is required"),
});

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details" };
  }

  const next = String(formData.get("next") ?? "") || "/workspaces";

  try {
    await signIn("password", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: next,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "That email and password combination did not match" };
    }
    throw error;
  }

  return {};
}

export async function magicLinkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!z.email().safeParse(email).success) {
    return { error: "Enter a valid email" };
  }

  const user = await db.user.findUnique({ where: { email } });

  // Always report success: telling a stranger whether an address has an
  // account is an account-enumeration hole.
  if (user) {
    const token = await createMagicLinkToken(email);
    const link = appUrl(`/auth/magic?token=${encodeURIComponent(token)}`);

    await sendEmail({
      to: email,
      subject: "Your Take 10 Marketing sign-in link",
      html: `
        <p>Hi ${user.name ?? "there"},</p>
        <p>Use this link to sign in. It expires in 15 minutes and works once.</p>
        <p><a href="${link}">Sign in to Take 10 Marketing</a></p>
        <p style="color:#64748b;font-size:12px">If you didn't request this, you can ignore it.</p>
      `,
      metadata: { kind: "magic-link" },
    });
  }

  return {
    notice:
      "If that address has an account, a sign-in link is on its way. No email provider is configured yet, so in development it lands at /dev/inbox.",
  };
}
