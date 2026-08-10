import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { consumeMagicLinkToken } from "./tokens";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
    };
  }
}

export const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // JWT sessions: credentials sign-in cannot use database sessions, and this
  // keeps every request from hitting the DB just to resolve identity.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      id: "password",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });

        // Always run a comparison, even when the user is missing, so response
        // timing does not reveal which addresses have accounts.
        const hash =
          user?.passwordHash ??
          "$2a$12$0000000000000000000000000000000000000000000000000000";
        const ok = await verifyPassword(password, hash);

        if (!user?.passwordHash || !ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),

    Credentials({
      id: "magic-link",
      name: "Magic link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(raw) {
        const token = String(raw?.token ?? "");
        if (!token) return null;

        const email = await consumeMagicLinkToken(token);
        if (!email) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;

        // Following a link proves control of the mailbox.
        if (!user.emailVerified) {
          await db.user.update({
            where: { id: user.id },
            data: { emailVerified: new Date() },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
