"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui";
import { signupAction, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export function SignupForm() {
  const [state, submit, pending] = useActionState(signupAction, EMPTY);

  return (
    <form action={submit} className="space-y-3">
      <Field label="Agency name">
        <Input
          name="organizationName"
          required
          placeholder="Take 10 Marketing"
          autoComplete="organization"
        />
      </Field>
      <Field label="Your name">
        <Input name="name" required autoComplete="name" placeholder="Alex Rivera" />
      </Field>
      <Field label="Email">
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@agency.com"
        />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <Input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </Field>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create agency"}
      </Button>
    </form>
  );
}
