"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui";
import { loginAction, magicLinkAction, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [passwordState, submitPassword, passwordPending] = useActionState(
    loginAction,
    EMPTY,
  );
  const [magicState, submitMagic, magicPending] = useActionState(
    magicLinkAction,
    EMPTY,
  );

  const state = mode === "password" ? passwordState : magicState;
  const pending = mode === "password" ? passwordPending : magicPending;

  return (
    <div className="space-y-4">
      {mode === "password" ? (
        <form action={submitPassword} className="space-y-3">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Email">
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@agency.com"
            />
          </Field>
          <Field label="Password">
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : (
        <form action={submitMagic} className="space-y-3">
          <Field
            label="Email"
            hint="We'll send a link that signs you in without a password."
          >
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@agency.com"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Email me a link"}
          </Button>
        </form>
      )}

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-muted-foreground text-sm" role="status">
          {state.notice}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setMode(mode === "password" ? "magic" : "password")}
        className="text-muted-foreground hover:text-foreground w-full text-center text-sm underline-offset-4 hover:underline"
      >
        {mode === "password"
          ? "Sign in with an email link instead"
          : "Use a password instead"}
      </button>
    </div>
  );
}
