import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const MAGIC_LINK_TTL_MINUTES = 15;
export const INVITE_TTL_DAYS = 14;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare so token verification does not leak length/prefix. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function createMagicLinkToken(email: string): Promise<string> {
  const token = generateToken();
  const expires = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000);

  // Only one live link per address: issuing a new one invalidates the old.
  await db.verificationToken.deleteMany({ where: { identifier: email } });
  await db.verificationToken.create({
    data: { identifier: email, token, expires },
  });

  return token;
}

/**
 * Verify and burn a magic-link token. Single-use: the row is deleted before the
 * caller is told it succeeded, so a replayed link cannot sign in twice.
 */
export async function consumeMagicLinkToken(
  token: string,
): Promise<string | null> {
  if (!token) return null;

  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record) return null;

  await db.verificationToken.delete({ where: { token } }).catch(() => null);

  if (record.expires.getTime() < Date.now()) return null;
  return record.identifier;
}

export function appUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
