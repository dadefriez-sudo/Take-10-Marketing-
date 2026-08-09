"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { acceptInviteAction, type InviteState } from "./actions";

const EMPTY: InviteState = {};

export function AcceptInviteForm({
  token,
  email,
  signedInAs,
}: {
  token: string;
  email: string;
  signedInAs: string | null;
}) {
  const [state, submit, pending] = useActionState(acceptInviteAction, EMPTY);
  const router = useRouter();
  const alreadySignedIn = signedInAs?.toLowerCase() === email.toLowerCase();

  return (
    <form
      action={async (formData) => {
        await submit(formData);
        if (alreadySignedIn) router.push("/workspaces");
      }}
      className="space-y-3"
    >
      <input type="hidden" name="token" value={token} />

      <Field label="Email">
        <Input value={email} disabled readOnly />
      </Field>

      {alreadySignedIn ? (
        <p className="text-muted-foreground text-sm">
          You&apos;re already signed in as {email}. Accepting adds this
          organization to your account.
        </p>
      ) : (
        <>
          <Field label="Your name">
            <Input name="name" autoComplete="name" placeholder="Jordan Lee" />
          </Field>
          <Field label="Choose a password" hint="At least 10 characters.">
            <Input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </Field>
        </>
      )}

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
