"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export interface ActionState {
  error?: string;
}

export async function consumeMagicLinkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "The sign-in link is missing its token." };

  try {
    await signIn("magic-link", { token, redirectTo: "/workspaces" });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error:
          "This link has expired or was already used. Sign-in links last 15 minutes and work once.",
      };
    }
    throw error;
  }

  return {};
}
